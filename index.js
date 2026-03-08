module.exports = {
  id: "auto-recall",
  activate({ registerHook }) {
    registerHook("preGenerate", async ({ context, message }) => {
      const { spawn } = require("child_process");
      const path = require("path");

      // ========== 自动捕获 (autoCapture) ==========
      // 这些参数可以从 OpenClaw 配置文件传入，为简化此处硬编码
      const autoCaptureEnabled = true;   // memory.autoCapture
      const captureCategories = ["preference", "decision", "fact", "lesson"]; // autoCaptureCategories

      if (autoCaptureEnabled) {
        const captureHookPath = path.join(__dirname, "auto-capture-hook.js");
        const captureEnv = Object.assign({}, process.env, {
          OPENCLAW_USER_MESSAGE: message,
          CAPTURE_CATEGORIES: captureCategories.join(",")
        });

        // 异步执行捕获，不阻塞主流程（但 Promise 会等待其完成）
        await new Promise((resolve) => {
          const captureProc = spawn("node", [captureHookPath], {
            env: captureEnv,
            stdio: ["ignore", "pipe", "pipe"]
          });

          captureProc.stderr.on("data", (data) => {
            console.error("AutoCapture Hook Error:", data.toString());
          });

          captureProc.on("close", (code) => {
            if (code !== 0) {
              console.error(`AutoCapture hook exited with code ${code}`);
            }
            resolve(); // 无论成功失败，都继续执行
          });
        });
      }

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
