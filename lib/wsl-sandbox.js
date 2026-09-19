import { SandboxProvider } from "@deepseek-ai/dsh-sandbox";

//#region src/host/wsl-sandbox.ts
/** The WSL world's no-op confinement: the caller's argv, unchanged. */
var WslSandboxProvider = class extends SandboxProvider {
	constructor(ctx) {
		super(ctx);
	}
	/**
	* Hand back the caller's own argv.
	* @param argv - the command the caller wants to run.
	* @returns the same argv, with the world's honest enforcement claim.
	*/
	confine(argv) {
		return {
			argv: [...argv],
			enforcement: "partial",
			denialSignatures: [],
			runnerFailureRules: []
		};
	}
};
var wsl_sandbox_default = WslSandboxProvider;

//#endregion
export { WslSandboxProvider, wsl_sandbox_default as default };
//# sourceMappingURL=wsl-sandbox.js.map