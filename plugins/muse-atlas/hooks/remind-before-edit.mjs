// Optional PreToolUse hook: before Muse Code edits a JavaScript, TypeScript or Python file, remind the person they
// can bet on the edit with /atlas. OFF by default: it prints nothing unless the file "remind-before-edit" exists in
// this plugin's data folder (MUSE_PLUGIN_DATA_DIR). It never blocks, changes or reads the edit; it reads only the
// tool name and the target path from the hook's input, sends nothing anywhere, and always exits 0.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = process.env.MUSE_PLUGIN_DATA_DIR ?? process.env.PLUGIN_DATA ?? "";
const on = dataDir !== "" && existsSync(join(dataDir, "remind-before-edit"));
if (on) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    input = {};
  }
  const tool = String(input.tool_name ?? input.toolName ?? "");
  const args = input.tool_input ?? input.toolInput ?? {};
  const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
  if (/edit|write|patch/i.test(tool) && /\.(m|c)?(j|t)s$|\.py$/i.test(path)) {
    process.stdout.write(JSON.stringify({ systemMessage: `Atlas: after this edit you can type /atlas ${path} to bet on what it will do before you accept it.` }) + "\n");
  }
}
process.exit(0);
