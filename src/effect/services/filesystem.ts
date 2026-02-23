import type * as nodeFs from "node:fs";
import * as Context from "effect/Context";

export interface FileSystemService {
	readonly readFileSync: (path: string, encoding: BufferEncoding) => string;
	readonly writeFileSync: (
		path: string,
		data: string | NodeJS.ArrayBufferView,
	) => void;
	readonly existsSync: (path: string) => boolean;
	readonly mkdirSync: (
		path: string,
		options?: nodeFs.MakeDirectoryOptions,
	) => string | undefined;
	readonly mkdtempSync: (prefix: string) => string;
	readonly readdirSync: {
		(path: string): string[];
		(
			path: string,
			options: { withFileTypes: true; recursive?: boolean },
		): nodeFs.Dirent[];
		(path: string, options: { recursive?: boolean }): string[];
	};
	readonly statSync: (path: string) => nodeFs.Stats;
	readonly rmSync: (path: string, options?: nodeFs.RmOptions) => void;
}

export class FileSystem extends Context.Tag("FileSystem")<
	FileSystem,
	FileSystemService
>() {}
