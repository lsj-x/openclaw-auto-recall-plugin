module.exports = {
  id: "auto-recall",
  activate({ registerHook }) {
    const { spawn } = require("child_process");
    const path = require("path");

    const handlePreGenerate = async ({ context, message }) => {
      const triggerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const msgText = typeof message === "string" ? message : "";
      console.error(
        `[auto-recall] pre-generate triggered: id=${triggerId} messageLength=${msgText.length}`
      );
      // ========== 自动捕获 (autoCapture) ==========
      // OpenClaw 2026.2.12：捕获由 auto-recall-hook.js 内部统一执行（规则 + 条件 LLM）
      // 避免双写导致重复入库

      // ========== 自动召回 (autoRecall) ==========
      const recallThreshold = process.env.MEMORY_RECALL_THRESHOLD || "0.3"; // memory.threshold
      const recallLimit = process.env.MEMORY_RECALL_LIMIT || "5"; // vectorRecall.limit

      const hookPath = path.join(__dirname, "auto-recall-hook.js");
      const env = Object.assign({}, process.env, {
        OPENCLAW_USER_MESSAGE: msgText,
        AUTO_CAPTURE_ENABLED: process.env.AUTO_CAPTURE_ENABLED || "true",
        CAPTURE_CATEGORIES:
          process.env.CAPTURE_CATEGORIES || "preference,decision,fact,lesson",
        MEMORY_RECALL_LIMIT: recallLimit,
        MEMORY_RECALL_THRESHOLD: recallThreshold
      });

      return new Promise((resolve) => {
        const child = spawn("node", [hookPath], { env, stdio: ["ignore", "pipe", "pipe"] });

        let output = "";
        child.stdout.on("data", (data) => (output += data.toString()));
        child.stderr.on("data", (data) =>
          console.error("AutoRecall Hook Error:", data.toString())
        );

        child.on("close", (code) => {
          if (code !== 0) return resolve({});
          try {
            const recallData = JSON.parse(output);
            if (recallData.context) {
              context.prependText(recallData.context);
            }
          } catch (e) {
            console.error("Failed to parse auto-recall output:", e);
          }
          resolve({});
        });
      });
    };

    // 兼容不同 OpenClaw 版本可能存在的 hook 注册签名差异
    const hookCandidates = ["preGenerate", "pre_generate", "beforeGenerate"];
    let registered = false;

    const tryRegister = (hookName) => {
      // 新版常见签名：registerHook({ name, handler })
      try {
        registerHook({ name: hookName, handler: handlePreGenerate });
        return true;
      } catch (_) {
        // 旧版签名：registerHook(name, handler)
        registerHook(hookName, handlePreGenerate);
        return true;
      }
    };

    for (const hookName of hookCandidates) {
      try {
        if (tryRegister(hookName)) {
          registered = true;
          console.error(`[auto-recall] registered hook: ${hookName}`);
          break;
        }
      } catch (err) {
        console.error(`[auto-recall] registerHook failed for ${hookName}: ${err.message}`);
      }
    }

    if (!registered) {
      console.error("[auto-recall] no compatible pre-generate hook was registered");
    }
  },
  deactivate() {}
};
