module.exports = {
  id: "auto-recall",
  activate({ registerHook }) {
    registerHook("preGenerate", async ({ context, message }) => {
      const { spawn } = require("child_process");
      const path = require("path");

      // ========== 自动捕获 (autoCapture) ==========
      // OpenClaw 2026.2.12：捕获由 auto-recall-hook.js 内部统一执行（规则 + 条件 LLM）
      // 避免与 auto-capture-hook.js 双写导致重复入库

      // ========== 自动召回 (autoRecall) ==========
      // 读取阈值和限制（可以从环境变量传入，这里沿用原有逻辑）
      const recallThreshold = process.env.MEMORY_RECALL_THRESHOLD || "0.3"; // memory.threshold
      const recallLimit = process.env.MEMORY_RECALL_LIMIT || "5";           // vectorRecall.limit

      const hookPath = path.join(__dirname, "auto-recall-hook.js");
      const env = Object.assign({}, process.env, {
        OPENCLAW_USER_MESSAGE: message,
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
    });
  },
  deactivate() {}
};
