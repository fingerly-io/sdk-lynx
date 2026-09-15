/** @lynxmodule */
export declare class Fingerly {
  configure(apiKey: string, endpoint: string, platform: string): void;
  identify(tag: string | null, submit: boolean, success: (json: string) => void, failure: (error: string) => void): void;
  collect(success: (json: string) => void, failure: (error: string) => void): void;
  sdkVersion(): string;
}
