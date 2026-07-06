export interface Io {
	print: (line: string) => void;
	error: (line: string) => void;
}

export const defaultIo: Io = {
	print: (line) => console.log(line),
	error: (line) => console.error(line),
};
