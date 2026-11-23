import { config } from "@/lib/config";
import { loadDirectory, type DirectoryLoader } from "./client";

/** The app's directory for its configured network (memoised in `loadDirectory`). */
export const directoryLoader: DirectoryLoader = () => loadDirectory(config.network);
