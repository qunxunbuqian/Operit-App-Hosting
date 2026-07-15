/**
 * app_lock_daemon_v11.js - 多应用独立计时 + 浮窗稳定修复 + AI远程解锁
 * 
 * v12 新增:
 *   1. threads 保活: 用 threads.start + sleep 替代 setInterval
 *      → 防止 Android Doze 模式挂起 JS 线程，根治 15 分钟崩溃
 *   2. AI 远程解锁: 检测 config._unlockFlag，≤500ms 即时关闭浮窗
 *      → 配合 app_hosting_v2 的 app_lock_unlock 工具使用
 *   3. 更稳健的退出: monitorRunning 标志 + Thread.interrupt()
 * 
 * v11 修复:
 *   1. 计时器字典化: timerAccMap[pkg] / timerLastTickMap[pkg]
 *      → 每个app独立计时，切app互不干扰
 *   2. 浮窗归属追踪: overlayForPkg 记录当前浮窗所属包名
 *      → 不再因遍历其他app条目而误关浮窗，彻底消除闪烁
 *   3. 主循环简化: 只处理前台app，不再遍历所有条目判断浮窗
 *   4. showCountdown/showLockScreen 增加 pkg 参数
 * 
 * v10: 启动自复位（active→true, mode→timer）
 * v9:  倒计时解锁持久化（基于系统时间）
 */

"ui";

// ======= 配置 =======
var CONFIG_PATH = "/sdcard/Download/app_lock/config.json";
var LOG_PATH = "/sdcard/Download/app_lock/daemon_v11.log";
var TICK = 500;

// ======= 状态 =======
var overlay = null;
var overlayType = "";        // "countdown" | "lock" | ""
var overlayForPkg = "";      // ★ v11: 当前浮窗对应的包名
var pwdInput = "";
var timerAccMap = {};        // ★ v11: { pkg: accumulatedSeconds } — 每app独立计时
var timerLastTickMap = {};   // ★ v11: { pkg: lastTickTimestamp }
var monitorRunning = true;
var monitorThread = null;
var prevFg = "";  // ★ v11.2: 跟踪上一次前台包名，用于检测切应用

// ======= 工具 =======
function dlog(m) {
    try {
        files.append(LOG_PATH, "[" + new Date().toLocaleTimeString() + "] " + m + "\n");
    } catch(e) {}
}

function readCfg() {
    try { return JSON.parse(files.read(CONFIG_PATH)); }
    catch(e) {
        return {
            daemonRunning: true,
            defaultPassword: "1784",
            apps: {}
        };
    }
}

function writeCfg(c) {
    try { files.write(CONFIG_PATH, JSON.stringify(c, null, 2)); }
    catch(e) { dlog("writeCfg err: " + e); }
}

function fmtTime(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function nowSec() {
    return Math.floor(Date.now() / 1000);
}

// ======= 浮窗管理 =======
function closeOverlay() {
    var old = overlay;
    overlay = null;
    overlayType = "";
    overlayForPkg = "";  // ★ v11
    pwdInput = "";
    if (old) {
        try { old.close(); } catch(e) {
            dlog("closeOverlay err: " + e);
        }
    }
}

// ======= 倒计时浮窗（白色椭圆胶囊，顶部居中，不阻挡触摸）=======
// ★ v11: 增加 pkg 参数，设置 overlayForPkg
function showCountdown(rem, appName, pkg) {
    // ★ v11: 如果已经是同类型同包名的浮窗，不重建
    if (overlayType === "countdown" && overlayForPkg === pkg && overlay) {
        updateCountdownText(rem);
        return;
    }
    closeOverlay();
    overlayType = "countdown";
    overlayForPkg = pkg;  // ★ v11
    var ts = fmtTime(rem);
    
    try {
        var w = floaty.rawWindow(
            '<frame w="*" h="*" gravity="top|center">' +
            '<card w="110dp" h="38dp" cardCornerRadius="19dp" cardElevation="3dp" ' +
            'bg="#FFFFFF" layout_gravity="top|center" margin="10">' +
            '<horizontal gravity="center" w="*" h="*">' +
            '<text text="🔒 " textSize="14sp" gravity="center"/>' +
            '<text id="cdText" text="' + ts + '" textColor="#4A4A4A" ' +
            'textSize="18sp" textStyle="bold" gravity="center"/>' +
            '</horizontal></card></frame>'
        );
        w.setSize(-1, -1);
        w.setPosition(0, 0);
        try { w.setTouchable(false); } catch(e) {}
        overlay = w;
        dlog("⏱ countdown [" + pkg + "]: " + ts);
    } catch(e) {
        dlog("showCountdown err: " + e);
        overlayType = "";
        overlayForPkg = "";
        overlay = null;
    }
}

function updateCountdownText(rem) {
    if (overlayType !== "countdown" || !overlay) return false;
    try {
        var el = overlay.cdText;
        if (el) {
            el.setText(fmtTime(rem));
            var color = rem <= 10 ? "#E53935" : "#4A4A4A";
            el.setTextColor(android.graphics.Color.parseColor(color));
            return true;
        }
    } catch(e) {}
    return false;
}

// ======= 锁屏浮窗（全屏，拦截触摸）=======
// ★ v11: 增加 pkg 参数
function showLockScreen(password, appName, unlockDelay, lockStartTimeFromCfg, pkg) {
    // ★ v11: 如果已经是同类型同包名的浮窗，不重建
    if (overlayType === "lock" && overlayForPkg === pkg && overlay) {
        if (unlockDelay > 0 && lockStartTimeFromCfg > 0) {
            updateLockCountdownFromConfig(unlockDelay, lockStartTimeFromCfg);
        }
        return;
    }
    closeOverlay();
    overlayType = "lock";
    overlayForPkg = pkg;  // ★ v11
    pwdInput = "";
    var ud = unlockDelay || 0;

    var lockRem = ud;
    if (ud > 0 && lockStartTimeFromCfg > 0) {
        var elapsed = nowSec() - lockStartTimeFromCfg;
        lockRem = ud - elapsed;
        if (lockRem < 0) lockRem = 0;
        dlog("🔓 Lock started @" + lockStartTimeFromCfg + ", elapsed=" + elapsed + "s, rem=" + lockRem + "s");
    }

    var label = (appName || "应用") + " 已锁定";
    
    var unlockHintHtml = "";
    if (ud > 0 && lockRem > 0) {
        unlockHintHtml = '<text id="unlockCdText" text="🔓 ' + fmtTime(lockRem) + ' 后自动解锁" ' +
            'textColor="#8B9DC3" textSize="14sp" gravity="center" marginBottom="20"/>';
    } else if (ud > 0 && lockRem <= 0) {
        unlockHintHtml = '<text id="unlockCdText" text="🔓 即将自动解锁..." ' +
            'textColor="#8B9DC3" textSize="14sp" gravity="center" marginBottom="20"/>';
    }

    var xml = '<frame w="*" h="*">' +
        '<vertical w="*" h="*" bg="#F5F0E1">' +
        
        '<frame w="*" h="0" layout_weight="1"/>' +
        
        '<vertical w="*" gravity="center">' +
        
        '<text text="🔒" textSize="48sp" gravity="center" marginBottom="12"/>' +
        '<text text="' + label + '" textColor="#5D4E37" textSize="20sp" ' +
        'textStyle="bold" gravity="center" marginBottom="4"/>' +
        '<text text="请输入密码解锁" textColor="#B0A090" textSize="13sp" ' +
        'gravity="center" marginBottom="16"/>' +
        
        unlockHintHtml +
        
        // 密码点
        '<horizontal gravity="center" marginBottom="24">' +
        '<text id="dot0" text="○" textSize="26sp" textColor="#C0B0A0" margin="8"/>' +
        '<text id="dot1" text="○" textSize="26sp" textColor="#C0B0A0" margin="8"/>' +
        '<text id="dot2" text="○" textSize="26sp" textColor="#C0B0A0" margin="8"/>' +
        '<text id="dot3" text="○" textSize="26sp" textColor="#C0B0A0" margin="8"/>' +
        '</horizontal>' +
        
        // 九键键盘 (行1)
        '<horizontal gravity="center">' +
        '<frame id="k1" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="1" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k2" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="2" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k3" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="3" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '</horizontal>' +
        
        '<horizontal gravity="center">' +
        '<frame id="k4" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="4" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k5" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="5" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k6" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="6" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '</horizontal>' +
        
        '<horizontal gravity="center">' +
        '<frame id="k7" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="7" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k8" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="8" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k9" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="9" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '</horizontal>' +
        
        '<horizontal gravity="center">' +
        '<frame id="kc" w="72" h="64" margin="4" bg="#E8DFD0" cornerRadius="12" ' +
        'clickable="true"><text text="清除" textSize="16sp" textColor="#8B7355" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="k0" w="72" h="64" margin="4" bg="#FFFFFF" cornerRadius="12" ' +
        'clickable="true"><text text="0" textSize="24sp" textColor="#5D4E37" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '<frame id="kd" w="72" h="64" margin="4" bg="#E8DFD0" cornerRadius="12" ' +
        'clickable="true"><text text="⌫" textSize="20sp" textColor="#8B7355" ' +
        'gravity="center" w="*" h="*"/></frame>' +
        '</horizontal>' +
        
        '</vertical>' +
        
        '<frame w="*" h="0" layout_weight="1"/>' +
        '</vertical></frame>';

    try {
        var w = floaty.rawWindow(xml);
        w.setSize(-1, -1);
        w.setPosition(0, 0);
        w.setTouchable(true);
        overlay = w;
        dlog("🔒 Lock screen created [" + pkg + "] (unlockDelay=" + ud + ", lockStartTime=" + (lockStartTimeFromCfg || 0) + ")");

        function updDots() {
            var dots = [w.dot0, w.dot1, w.dot2, w.dot3];
            for (var i = 0; i < 4; i++) {
                if (dots[i]) {
                    dots[i].setText(i < pwdInput.length ? "●" : "○");
                    dots[i].setTextColor(colors.parseColor(
                        i < pwdInput.length ? "#D4A574" : "#C0B0A0"));
                }
            }
        }

        for (var i = 0; i <= 9; i++) {
            (function(n) {
                var key = w["k" + n];
                if (key) {
                    key.on("click", function() {
                        if (pwdInput.length < 4) {
                            pwdInput += n;
                            updDots();
                            dlog("key " + n + " → input: " + pwdInput);
                            if (pwdInput.length === 4) {
                                setTimeout(function() {
                                    if (pwdInput === password) {
                                        dlog("✅ Password correct");
                                        doUnlock(pkg);
                                    } else {
                                        dlog("❌ Password wrong");
                                        toast("密码错误 ❌");
                                        pwdInput = "";
                                        updDots();
                                    }
                                }, 250);
                            }
                        }
                    });
                    dlog("bound k" + n);
                }
            })(String(i));
        }

        if (w.kc) {
            w.kc.on("click", function() {
                pwdInput = "";
                updDots();
                dlog("cleared");
            });
        }
        
        if (w.kd) {
            w.kd.on("click", function() {
                if (pwdInput.length > 0) {
                    pwdInput = pwdInput.slice(0, -1);
                    updDots();
                    dlog("backspace → input: " + pwdInput);
                }
            });
        }

    } catch(e) {
        dlog("showLockScreen err: " + e);
        toast("锁屏创建失败: " + e.message);
        closeOverlay();
        overlayType = "";
        overlayForPkg = "";
    }
}

// ★ v11: 更新锁屏倒计时文本
function updateLockCountdownFromConfig(unlockDelay, lockStartTimeFromCfg) {
    if (overlayType !== "lock" || !overlay) return false;
    if (!unlockDelay || unlockDelay <= 0 || !lockStartTimeFromCfg || lockStartTimeFromCfg <= 0) return false;
    try {
        var elapsed = nowSec() - lockStartTimeFromCfg;
        var rem = unlockDelay - elapsed;
        if (rem < 0) rem = 0;
        var el = overlay.unlockCdText;
        if (el) {
            el.setText("🔓 " + fmtTime(rem) + " 后自动解锁");
            return true;
        }
    } catch(e) {}
    return false;
}

// ======= 执行解锁（密码正确或倒计时归零）=======
// ★ v11.1: 改为 per-pkg 解锁，只解锁指定 app，不影响其他
function doUnlock(pkg) {
    if (!pkg) {
        dlog("⚠ doUnlock called without pkg, fallback to close overlay only");
        closeOverlay();
        return;
    }
    dlog("🔓 Unlocking [" + pkg + "]...");
    closeOverlay();
    var c = readCfg();
    var appName = (c && c.apps && c.apps[pkg] && c.apps[pkg].appName) || pkg;
    if (c && c.apps && c.apps[pkg]) {
        c.apps[pkg].active = false;
        c.apps[pkg].mode = "timer";
        c.apps[pkg].startTime = 0;
        c.apps[pkg].lockStartTime = 0;
        writeCfg(c);
    }
    // ★ v11.1: 只清除该 app 的计时状态
    delete timerAccMap[pkg];
    delete timerLastTickMap[pkg];
    toast("🔓 " + appName + " 已解锁！");
}

// ======= ★ v12 重写：前台监听循环 =======
function startMonitor() {
    dlog("▶ Monitor started v12 (TICK=" + TICK + "ms, threads keepalive, AI unlock)");

    monitorThread = threads.start(function() {
        while (monitorRunning) {
            try {
                var config = readCfg();
                
                // ★ v1.5: AI 远程解锁标志检测（最高优先级，≤500ms 响应）
                if (config._unlockFlag && config._unlockFlag.pkg) {
                    var unlockPkg2 = config._unlockFlag.pkg;
                    dlog("🔓 AI remote unlock detected: " + unlockPkg2);
                    
                    if (overlayForPkg === unlockPkg2) {
                        closeOverlay();
                    }
                    
                    delete timerAccMap[unlockPkg2];
                    delete timerLastTickMap[unlockPkg2];
                    
                    if (config.apps && config.apps[unlockPkg2]) {
                        config.apps[unlockPkg2].active = false;
                        config.apps[unlockPkg2].mode = "timer";
                        config.apps[unlockPkg2].startTime = 0;
                        config.apps[unlockPkg2].lockStartTime = 0;
                    }
                    delete config._unlockFlag;
                    writeCfg(config);
                    var unlName = (config.apps && config.apps[unlockPkg2]) ? config.apps[unlockPkg2].appName : unlockPkg2;
                    toast("🔓 " + unlName + " 已远程解锁！");
                    sleep(TICK);
                    continue;
                }
                
                if (!config.daemonRunning) {
                    dlog("⏹ daemonRunning = false, stopping");
                    closeOverlay();
                    monitorRunning = false;
                    exit();
                    return;
                }

            var fg = "";
            try { fg = currentPackage(); } catch(e) {}
            if (!fg) { sleep(TICK); continue; }

            // ★ v11.2: 检测前台应用切换
            var fgChanged = (fg !== prevFg);
            prevFg = fg;

            // ==========================================
            // ★ v11: 第一遍 — 轮询所有 locked 模式 app
            //   检查倒计时解锁是否到期（与前台无关）
            // ==========================================
            for (var pkg in config.apps) {
                var app = config.apps[pkg];
                if (!app.active || app.mode !== "locked") continue;
                
                var ud = app.unlockDelay || 0;
                var lst = app.lockStartTime || 0;
                
                if (ud > 0 && lst > 0) {
                    var elapsed = nowSec() - lst;
                    var rem = ud - elapsed;
                    
                    if (rem <= 0) {
                        dlog("⏰ Auto-unlock triggered for " + (app.appName || pkg) + 
                             " (elapsed=" + elapsed + "s >= unlockDelay=" + ud + "s)");
                        doUnlock(pkg);
                        sleep(TICK);
                        continue;
                    }
                    
                    // 如果当前在前台且锁屏在显示，更新倒计时文本
                    if (fg === pkg && overlayType === "lock" && overlayForPkg === pkg) {
                        updateLockCountdownFromConfig(ud, lst);
                    }
                    
                    dlog("🕐 [" + (app.appName || pkg) + "] locked, rem=" + rem + "s (fg=" + fg + ")");
                }
            }

            // ==========================================
            // ★ v11: 第二遍 — 只处理前台 app
            //   不再遍历所有条目判断浮窗，消除误关
            // ==========================================
            var fgApp = config.apps[fg];

            if (!fgApp || !fgApp.active) {
                // 前台不是被锁app → 关闭浮窗
                // ★ v11: 但不重置 timerLastTick，保留计时断点
                if (overlayType !== "") {
                    dlog("← fg=" + fg + " not a locked app, closing overlay");
                    closeOverlay();
                }
                sleep(TICK);
                continue;
            }

            if (fgApp.mode === "timer") {
                // ===== ★ v11: 计时模式（每app独立累积） =====
                var now = nowSec();
                // ★ v11.2: 首次进入或从其他应用切回时，重置计时起点避免壁钟泄漏
                if (!(fg in timerLastTickMap) || fgChanged) {
                    timerLastTickMap[fg] = now;
                }
                var delta = now - timerLastTickMap[fg];
                // 防止切走太久回来异常跳跃（上限5秒）
                if (delta > 0 && delta <= 5) {
                    timerAccMap[fg] = (timerAccMap[fg] || 0) + delta;
                }
                timerLastTickMap[fg] = now;
                
                var acc = timerAccMap[fg] || 0;
                var rem = fgApp.duration - Math.floor(acc);

                if (rem <= 0) {
                    dlog("⏰ Timer expired [" + fg + "] (accumulated=" + acc + "s)");
                    closeOverlay();
                    var cfg2 = readCfg();
                    if (cfg2.apps[fg]) {
                        cfg2.apps[fg].mode = "locked";
                        cfg2.apps[fg].startTime = 0;
                        cfg2.apps[fg].lockStartTime = nowSec();
                        writeCfg(cfg2);
                    }
                    timerAccMap[fg] = 0;
                    timerLastTickMap[fg] = 0;
                    var ud2 = fgApp.unlockDelay || 0;
                    var msg = "⏰ 时间到！" + (fgApp.appName || "应用") + " 已锁定 🔒";
                    if (ud2 > 0) msg += "（" + fmtTime(ud2) + "后自动解锁）";
                    toast(msg);
                    sleep(TICK);
                    continue;
                }

                if (overlayType !== "countdown" || overlayForPkg !== fg) {
                    showCountdown(rem, fgApp.appName, fg);
                } else {
                    updateCountdownText(rem);
                }

            } else if (fgApp.mode === "locked") {
                // ===== 锁定模式（前台） =====
                var ud = fgApp.unlockDelay || 0;
                var lst = fgApp.lockStartTime || 0;

                if (overlayType !== "lock" || overlayForPkg !== fg) {
                    dlog("→ creating lock screen [" + fg + "] (unlockDelay=" + ud + ", lockStartTime=" + lst + ")");
                    showLockScreen(config.defaultPassword, fgApp.appName, ud, lst, fg);
                } else if (ud > 0 && lst > 0) {
                    updateLockCountdownFromConfig(ud, lst);
                }
            }

        } catch(e) {
            dlog("⚠ loop err: " + e);
        }
        sleep(TICK);
        }
    });
}

// ======= 启动 =======
try {
    files.ensureDir("/sdcard/Download/app_lock");
    files.write(LOG_PATH, "");
} catch(e) {}

// ★ v10: 启动时自动复位
var cfg0 = readCfg();
if (cfg0 && cfg0.apps) {
    var changed = false;
    for (var p in cfg0.apps) {
        if (!cfg0.apps[p].active || cfg0.apps[p].mode !== "timer" || cfg0.apps[p].lockStartTime !== 0) {
            cfg0.apps[p].active = true;
            cfg0.apps[p].mode = "timer";
            cfg0.apps[p].startTime = 0;
            cfg0.apps[p].lockStartTime = 0;
            changed = true;
        }
    }
    if (changed) {
        writeCfg(cfg0);
        dlog("🔄 Config reset: all apps → active=true, mode=timer");
    }
}

// ★ v11: 清空所有计时状态
timerAccMap = {};
timerLastTickMap = {};

dlog("══════ Daemon v12 started ══════");
dlog("→ ★ v12: threads 保活（防 Doze 挂起）");
dlog("→ ★ v12: _unlockFlag AI 远程解锁（≤500ms 响应）");
dlog("→ ★ v11: 每app独立计时 (timerAccMap)");
dlog("→ ★ v10: 启动自复位（active→true, mode→timer）");
dlog("→ ★ v9: 倒计时解锁持久化（基于系统时间）");
dlog("→ Target config: " + JSON.stringify(readCfg()));
toast("🔐 应用锁 v12 (独立计时·防闪烁·AI解锁)");

startMonitor();

events.on("exit", function() {
    monitorRunning = false;
    try { monitorThread.interrupt(); } catch(e) {}
    closeOverlay();
    dlog("══════ Daemon v12 exited ══════");
});
