export interface Io {
	print: (line: string) => void;
	error: (line: string) => void;
	/** Print question, read one trimmed line from stdin. */
	ask: (question: string) => Promise<string>;
}

export const defaultIo: Io = {
	print: (line) => console.log(line),
	error: (line) => console.error(line),
	ask: async (question) => {
		const readline = await import("node:readline/promises");
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		try {
			return (await rl.question(question)).trim();
		} finally {
			rl.close();
		}
	},
};
