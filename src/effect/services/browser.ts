import * as Context from "effect/Context";

export interface BrowserService {
  readonly open: (url: string) => Promise<unknown>;
}

export class Browser extends Context.Tag("Browser")<
  Browser,
  BrowserService
>() {}
