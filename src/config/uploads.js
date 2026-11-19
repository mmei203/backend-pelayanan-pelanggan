import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const uploadsDir = process.env.VERCEL
	? path.join(os.tmpdir(), "uploads")
	: path.join(projectRoot, "uploads");
