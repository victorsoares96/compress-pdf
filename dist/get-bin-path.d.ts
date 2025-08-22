declare function getBinPath(platform: NodeJS.Platform): "/usr/bin/gs" | "gswin64c" | "/opt/homebrew/bin/gs" | "/usr/local/bin/gs";

export { getBinPath as default };
