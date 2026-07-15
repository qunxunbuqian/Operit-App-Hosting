/**
 * app_lock_daemon_v11.js - 多应用独立计时 + 浮窗稳定修复
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
var monitorTimer = null;
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
        
        // 九键键盘
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
                }
            })(String(i));
        }

        if (w.kc) {
            w.kc.on("click", function() {
                pwdInput = "";
                updDots();
            });
        }
        
        if (w.kd) {
            w.kd.on("click", function() {
                if (pwdInput.length > 0) {
                    pwdInput = pwdInput.slice(0, -1);
                    updDots();
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
    delete timerAccMap[pkg];
    delete timerLastTickMap[pkg];
    toast("🔓 " + appName + " 已解锁！");
}

function startMonitor() {
    dlog("▶ Monitor started v11 (TICK=" + TICK + "ms, per-app timers)");

    monitorTimer = setInterval(function() {
        try {
            var config = readCfg();
            if (!config.daemonRunning) {
                dlog("⏹ daemonRunning = false, stopping");
                closeOverlay();
                clearInterval(monitorTimer);
                exit();
                return;
            }

            var fg = "";
            try { fg = currentPackage(); } catch(e) {}
            if (!fg) return;

            var fgChanged = (fg !== prevFg);
            prevFg = fg;

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
                        return;
                    }
                    
                    if (fg === pkg && overlayType === "lock" && overlayForPkg === pkg) {
                        updateLockCountdownFromConfig(ud, lst);
                    }
                }
            }

            var fgApp = config.apps[fg];

            if (!fgApp || !fgApp.active) {
                if (overlayType !== "") {
                    dlog("← fg=" + fg + " not a locked app, closing overlay");
                    closeOverlay();
                }
                return;
            }

            if (fgApp.mode === "timer") {
                var now = nowSec();
                if (!(fg in timerLastTickMap) || fgChanged) {
                    timerLastTickMap[fg] = now;
                }
                var delta = now - timerLastTickMap[fg];
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
                    return;
                }

                if (overlayType !== "countdown" || overlayForPkg !== fg) {
                    showCountdown(rem, fgApp.appName, fg);
                } else {
                    updateCountdownText(rem);
                }

            } else if (fgApp.mode === "locked") {
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
    }, TICK);
}

// ======= 启动 =======
try {
    files.ensureDir("/sdcard/Download/app_lock");
    files.write(LOG_PATH, "");
} catch(e) {}

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

timerAccMap = {};
timerLastTickMap = {};

dlog("══════ Daemon v11 started ══════");
dlog("→ ★ v11: 每app独立计时 (timerAccMap)");
dlog("→ ★ v11: 浮窗归属追踪 (overlayForPkg)");
dlog("→ ★ v10: 启动自复位（active→true, mode→timer）");
dlog("→ ★ v9: 倒计时解锁持久化（基于系统时间）");
dlog("→ Target config: " + JSON.stringify(readCfg()));
toast("🔐 应用锁 v11 (独立计时·防闪烁)");

startMonitor();

setInterval(function(){}, 5000);

events.on("exit", function() {
    closeOverlay();
    dlog("══════ Daemon v11 exited ══════");
});