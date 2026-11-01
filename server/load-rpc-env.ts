// Round 4: `pnpm dev:all` had no BASE_RPC_URL even with ~/.config/atlas/rpc.env on the machine: only the Fly deploy script read that
// file, and the server read nothing but the repo's .env. So a local server said it had no chain connection when it had one. The same
// rules as .env: a variable already set wins, and only key names are ever kept or printed. Imported after ./load-env, so .env wins too.

import { homedir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "./load-env";

export const RPC_ENV_PATH = join(homedir(), ".config", "atlas", "rpc.env");
export const rpcEnv = loadDotEnv(RPC_ENV_PATH);
