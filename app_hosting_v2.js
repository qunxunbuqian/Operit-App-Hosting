/*
 METADATA
{
      "name": "app_hosting_v2",

      "display_name": {
          "zh": "应用托管🔒",
          "en": "App Hosting🔒"
      },

      "author": "Xi,Rin",

 "description": {
           "zh": "应用锁配置管理工具集。\n\n⚠️ 使用前需安装 AutoJS6 并授予悬浮窗/无障碍权限，同时需要 Shizuku（或 Root）权限。\n\n【可配置项】\n• 被锁应用包名 — 要锁定的应用（如 com.tencent.mobileqq）\n• 锁定倒计时时长 — 锁定时长（秒），默认 30\n• 解锁密码 — 4位数字密码，默认 1784\n• 是否开启自动解锁 — 锁定后倒计时结束自动解锁\n• 自动解锁倒计时 — 锁定后多久自动解锁（秒），设为 0 则关闭自动解锁\n\n修改配置后自动重启 AutoJS6 守护进程，即时生效。\n\n【🔐 AI修改密码安全指南】\n• 永远不要直接传 defaultPassword 参数——调用参数会在 Operit UI 暴露明文\n• 正确流程：\n  1. 用 super_admin:shell + base64 写入临时文件：echo \"<密码的base64>\" | base64 -d > /sdcard/Download/.app_lock_pw\n  2. 调用 app_lock_edit_config 传 loadPasswordFromFile: \"true\"\n  3. 工具从文件读取密码后立即删除（读后即焚），返回结果始终是 \"****\"\n• ⚠️ 不要在 shell 中计算 base64！`echo -n \"密码\" | base64` 会在 Operit UI 调用参数中暴露明文。AI 应自行在内部完成 base64 编码（如 7720→NzcyMA==），直接用编码后的字符串写入：echo \"<base64>\" | base64 -d > /sdcard/Download/.app_lock_pw\n• 返回的 defaultPassword 始终为 \"****\"，不可用于获取真实密码",
           "en": "App Lock configuration management toolkit.\n\n⚠️ Requires AutoJS6 (with overlay & accessibility service) and Shizuku (or Root) permission.\n\n[Options]\n• App package name\n• Countdown duration (seconds, default 30)\n• Unlock password (4 digits, default 1784)\n• Auto-unlock toggle — enable/disable automatic unlock after lock\n• Auto-unlock delay — seconds before auto-unlock (set 0 to disable)\n\nAuto-restarts the AutoJS6 daemon on config change.\n\n[🔐 AI Password Security Guide]\n• NEVER pass defaultPassword directly — it will be exposed in Operit UI call parameters\n• Correct flow:\n  1. Write password via super_admin:shell + base64: echo \"<base64-of-password>\" | base64 -d > /sdcard/Download/.app_lock_pw\n  2. Call app_lock_edit_config with loadPasswordFromFile: \"true\"\n  3. Tool reads password from file then immediately deletes it (read-and-burn); returns \"****\"\n• ⚠️ DO NOT compute base64 in shell! `echo -n \"password\" | base64` exposes plaintext in Operit UI call parameters. AI must compute base64 internally (e.g. 7720→NzcyMA==), then write the encoded string directly: echo \"<base64>\" | base64 -d > /sdcard/Download/.app_lock_pw\n• All returned defaultPassword fields are always \"****\", cannot be used to retrieve real password"
       },
      "enabledByDefault": false,
      "category": "System",
     "tools": [
         {
             "name": "app_lock_get_config",
             "description": {
                 "zh": "读取当前应用锁的完整配置（config.json），包括默认密码、所有被锁应用及其设置。",
                 "en": "Read the full App Lock config (config.json), including default password and all locked apps with their settings."
             },
             "parameters": []
         },
         {
"name": "app_lock_edit_config",
              "description": {
                  "zh": "修改应用锁配置。可以改默认密码、添加/移除/修改被锁应用（包名、时长、模式、自动解锁开关、解锁冷却时间）。默认修改后自动重启脚本生效，传 autoRestart=false 可跳过自动重启。",
                  "en": "Edit the App Lock config. Change default password, add/remove/edit locked apps. Auto-restarts the daemon by default; pass autoRestart=false to skip."
              },
              "parameters": [
                  {
                      "name": "defaultPassword",
                      "description": { "zh": "新的默认解锁密码（4位数字），不传则保持原密码", "en": "New default unlock password (4 digits). Keeps current if omitted." },
                      "type": "string",
                      "required": false
                  },
                  {
                      "name": "appPackage",
                      "description": { "zh": "要修改的应用包名，例如 tv.danmaku.bili。不传则只改默认密码", "en": "App package name to edit, e.g. tv.danmaku.bili. Only changes default password if omitted." },
                      "type": "string",
                      "required": false
                  },
                  {
                      "name": "appName",
                      "description": { "zh": "应用显示名称（新增应用时必填）", "en": "App display name (required when adding new app)." },
                      "type": "string",
                      "required": false
                  },
                  {
                      "name": "duration",
                      "description": { "zh": "锁定倒计时时长（秒），默认30", "en": "Lock countdown duration in seconds, default 30." },
                      "type": "string",
                      "required": false
                  },
                  {
                      "name": "mode",
                      "description": { "zh": "锁定模式：timer（倒计时锁定）", "en": "Lock mode: timer (countdown lock)." },
                      "type": "string",
                      "required": false
                  },
                  {
                      "name": "active",
                      "description": { "zh": "是否启用该应用的锁定（true/false）", "en": "Enable/disable locking for this app (true/false)." },
                      "type": "string",
                      "required": false
                  },
{
                       "name": "unlockDelay",
                       "description": { "zh": "自动解锁倒计时时长（秒），设为 0 则关闭自动解锁，不传默认 60", "en": "Auto-unlock countdown duration in seconds. Set 0 to disable. Default 60." },
                       "type": "string",
                       "required": false
                   },
                   {
                       "name": "enableAutoUnlock",
                       "description": { "zh": "是否开启锁定后自动解锁。设为 false 关闭自动解锁（等价于 unlockDelay=0），不传则根据 unlockDelay 判断", "en": "Enable/disable auto-unlock after lock. Set false to disable (equivalent to unlockDelay=0). Falls back to unlockDelay if omitted." },
                       "type": "string",
                       "required": false
                   },
                  {
                      "name": "remove",
                      "description": { "zh": "设为 true 时删除指定应用（需同时传 appPackage）", "en": "Set to true to remove the specified app (requires appPackage)." },
                      "type": "string",
                      "required": false
                  },
                   {
                       "name": "autoRestart",
                       "description": { "zh": "修改后是否自动重启脚本。默认 true。传 false 跳过自动重启", "en": "Auto-restart daemon after edit. Default true. Pass false to skip." },
                       "type": "string",
                       "required": false
                   },
                   {
                       "name": "loadPasswordFromFile",
                       "description": { "zh": "设为 true 时，从 /sdcard/Download/.app_lock_pw 读取密码（读后即焚）。用于避免调用参数暴露密码明文。推荐先用 super_admin:shell + base64 写入文件：echo \"<base64>\" | base64 -d > /sdcard/Download/.app_lock_pw", "en": "Set to true to read password from /sdcard/Download/.app_lock_pw (file is deleted after reading). Hides password from call parameters. Recommend writing via super_admin:shell + base64 first: echo \"<base64>\" | base64 -d > /sdcard/Download/.app_lock_pw" },
                       "type": "string",
                       "required": false
                   }
               ]
         },
         {
             "name": "app_lock_restart",
             "description": {
                 "zh": "重启 AutoJS6 应用锁脚本（通过 Shizuku/Root 执行 am 命令），让配置修改生效。",
                 "en": "Restart the AutoJS6 app-lock script (via Shizuku/Root am command) to apply config changes."
             },
             "parameters": [
                 {
                     "name": "scriptPath",
                     "description": { "zh": "脚本路径，默认 /sdcard/脚本/app_lock_v11.js", "en": "Script path, default /sdcard/脚本/app_lock_v11.js." },
                     "type": "string",
                     "required": false
                 }
             ]
         },
         {
             "name": "app_lock_reset_config",
             "description": {
                 "zh": "将应用锁配置重置为默认值（空应用列表，默认密码 1784）。重置后需调用 app_lock_restart。",
                 "en": "Reset the App Lock config to defaults (empty app list, default password 1784). Call app_lock_restart afterwards."
             },
             "parameters": []
         }
     ]
 }*/
const appLockPackage = (function () {
    const CONFIG_PATH = "/sdcard/Download/app_lock/config.json";
    const DEFAULT_SCRIPT_PATH = "/sdcard/脚本/app_lock_v11.js";

    const DEFAULT_CONFIG = {
        daemonRunning: true,
        defaultPassword: "1784",
        apps: {}
    };

    async function readConfig() {
        const exists = await Tools.Files.exists(CONFIG_PATH);
        if (!exists || !exists.exists) {
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
        const result = await Tools.Files.read(CONFIG_PATH);
        try {
            return JSON.parse(result.content || result.data || "{}");
        } catch (e) {
            console.error("[app_lock] 配置解析失败，使用默认配置:", e.message);
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
    }

    async function writeConfig(config) {
        const content = JSON.stringify(config, null, 2);
        await Tools.Files.write(CONFIG_PATH, content, false);
        return { written: true, path: CONFIG_PATH };
    }

    // ★ v1.3: 脱敏——返回不暴露密码明文
    function maskConfig(cfg) {
        var masked = JSON.parse(JSON.stringify(cfg));
        if (masked.defaultPassword) {
            masked.defaultPassword = "****";
        }
        return masked;
    }

    async function app_lock_get_config() {
        try {
            const config = await readConfig();
            const appCount = Object.keys(config.apps || {}).length;
            return {
                success: true,
                config: maskConfig(config),
                summary: {
                    defaultPassword: "****",
                    daemonRunning: config.daemonRunning,
                    lockedAppCount: appCount,
                    lockedApps: Object.keys(config.apps || {}).map(function(pkg) {
                        const app = config.apps[pkg];
                        return {
                            package: pkg,
                            name: app.appName,
                            mode: app.mode,
                            duration: app.duration,
                            active: app.active,
                            unlockDelay: app.unlockDelay,
                            enableAutoUnlock: app.enableAutoUnlock !== undefined ? app.enableAutoUnlock : (app.unlockDelay > 0)
                        };
                    })
                }
            };
        } catch (e) {
            console.error("[app_lock_get_config] 错误:", e.message);
            return { success: false, error: e.message };
        }
    }

    async function app_lock_edit_config(params) {
        try {
            const config = await readConfig();

            const PW_FILE = "/sdcard/Download/.app_lock_pw";
            if (params.loadPasswordFromFile === "true") {
                try {
                    const pwResult = await Tools.Files.read(PW_FILE);
                    const pwFromFile = (pwResult.content || pwResult.data || "").trim();
                    if (pwFromFile) {
                        params.defaultPassword = pwFromFile;
                    }
                    await Tools.Files.delete(PW_FILE).catch(function(){});
                } catch (e) {}
            }

            if (params.defaultPassword !== undefined && params.defaultPassword !== "") {
                config.defaultPassword = params.defaultPassword;
            }

            if (params.remove === "true" && params.appPackage) {
                if (config.apps && config.apps[params.appPackage]) {
                    const removedName = config.apps[params.appPackage].appName;
                    delete config.apps[params.appPackage];
                    await writeConfig(config);
                    
                    let restartInfo = null;
                    if (params.autoRestart !== "false") {
                        try {
                            restartInfo = await app_lock_restart({ scriptPath: params.scriptPath });
                        } catch (re) {
                            restartInfo = { attempted: true, error: re.message };
                        }
                    }

                    return {
                        success: true,
                        action: "removed",
                        package: params.appPackage,
                        appName: removedName,
                        config: maskConfig(config),
                        autoRestarted: params.autoRestart !== "false",
                        restartInfo: restartInfo
                    };
                } else {
                    return {
                        success: false,
                        error: "应用 " + params.appPackage + " 不在配置中，无法删除"
                    };
                }
            }

            if (params.appPackage) {
                if (!config.apps) {
                    config.apps = {};
                }

                const existing = config.apps[params.appPackage] || {};

                let finalUnlockDelay;
                let finalEnableAutoUnlock;

                if (params.unlockDelay !== undefined) {
                    finalUnlockDelay = parseInt(params.unlockDelay, 10);
                    finalEnableAutoUnlock = finalUnlockDelay > 0;
                } else if (params.enableAutoUnlock !== undefined) {
                    if (params.enableAutoUnlock === "false") {
                        finalUnlockDelay = 0;
                        finalEnableAutoUnlock = false;
                    } else {
                        finalUnlockDelay = (existing.unlockDelay !== undefined) ? existing.unlockDelay : 60;
                        finalEnableAutoUnlock = true;
                    }
                } else {
                    finalUnlockDelay = (existing.unlockDelay !== undefined) ? existing.unlockDelay : 60;
                    finalEnableAutoUnlock = (existing.enableAutoUnlock !== undefined) ? existing.enableAutoUnlock : (finalUnlockDelay > 0);
                }

                const updatedApp = {
                    appName: params.appName || existing.appName || params.appPackage,
                    mode: params.mode || existing.mode || "timer",
                    duration: params.duration !== undefined ? parseInt(params.duration, 10) : (existing.duration || 30),
                    unlockDelay: finalUnlockDelay,
                    enableAutoUnlock: finalEnableAutoUnlock,
                    active: params.active !== undefined ? (params.active === "true") : (existing.active !== undefined ? existing.active : true),
                    lockStartTime: existing.lockStartTime || 0,
                    startTime: existing.startTime || 0,
                    unlockTime: existing.unlockTime || null
                };

                const isNew = !config.apps[params.appPackage];
                config.apps[params.appPackage] = updatedApp;

                await writeConfig(config);

                let restartInfo = null;
                if (params.autoRestart !== "false") {
                    try {
                        restartInfo = await app_lock_restart({ scriptPath: params.scriptPath });
                    } catch (re) {
                        restartInfo = { attempted: true, error: re.message };
                    }
                }

                return {
                    success: true,
                    action: isNew ? "added" : "updated",
                    package: params.appPackage,
                    app: updatedApp,
                    config: maskConfig(config),
                    autoRestarted: params.autoRestart !== "false",
                    restartInfo: restartInfo
                };
            }

            await writeConfig(config);
            
            let restartInfo = null;
            if (params.autoRestart !== "false") {
                try {
                    restartInfo = await app_lock_restart({ scriptPath: params.scriptPath });
                } catch (re) {
                    restartInfo = { attempted: true, error: re.message };
                }
            }
            
            return {
                success: true,
                action: "updated",
                changes: params.defaultPassword !== undefined ? ["defaultPassword"] : [],
                config: maskConfig(config),
                autoRestarted: params.autoRestart !== "false",
                restartInfo: restartInfo
            };
        } catch (e) {
            console.error("[app_lock_edit_config] 错误:", e.message);
            return { success: false, error: e.message };
        }
    }

    async function app_lock_restart(params) {
        try {
            const scriptPath = params.scriptPath || DEFAULT_SCRIPT_PATH;
            const pkgName = "org.autojs.autojs6";

            let killResult;
            try {
                killResult = await Tools.System.shell("am force-stop " + pkgName + " 2>&1");
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                killResult = { output: "force-stop skipped: " + e.message };
            }

            const startCmd = 'am start -a android.intent.action.VIEW ' +
                '-d "file://' + scriptPath + '" ' +
                '-t "application/x-javascript" ' +
                '-n ' + pkgName + '/org.autojs.autojs.external.open.RunIntentActivity ' +
                '--ez confirm true ' +
                '--ez autoRun true ' +
                '2>&1';
            
            let startResult;
            try {
                startResult = await Tools.System.shell(startCmd);
            } catch (e) {
                return {
                    success: false,
                    error: "启动失败: " + e.message,
                    killResult: killResult,
                    scriptPath: scriptPath
                };
            }

            return {
                success: true,
                scriptPath: scriptPath,
                killResult: killResult,
                startResult: startResult,
                hint: "已发送启动指令。如果仍弹出确认框，请在 AutoJS6 → 设置 → 运行 → 关闭「运行脚本前确认」。"
            };
        } catch (e) {
            console.error("[app_lock_restart] 错误:", e.message);
            return { success: false, error: e.message };
        }
    }

    async function app_lock_reset_config() {
        try {
            const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            await writeConfig(config);
            return {
                success: true,
                config: maskConfig(config),
                hint: "配置已重置。请调用 app_lock_restart 重启脚本生效。"
            };
        } catch (e) {
            console.error("[app_lock_reset_config] 错误:", e.message);
            return { success: false, error: e.message };
        }
    }

    return {
        app_lock_get_config: app_lock_get_config,
        app_lock_edit_config: app_lock_edit_config,
        app_lock_restart: app_lock_restart,
        app_lock_reset_config: app_lock_reset_config
    };
})();

exports.app_lock_get_config = appLockPackage.app_lock_get_config;
exports.app_lock_edit_config = appLockPackage.app_lock_edit_config;
exports.app_lock_restart = appLockPackage.app_lock_restart;
exports.app_lock_reset_config = appLockPackage.app_lock_reset_config;