/** @lynxmodule */
export declare class Fingerly {
  configure(apiKey: string, endpoint: string, platform: string, consent: string, playIntegrityCloudProjectNumber: number): void;
  setConsent(state: string): void;
  identify(tag: string | null, submit: boolean, automatic: boolean, success: (json: string) => void, failure: (error: string) => void): void;
  collect(success: (json: string) => void, failure: (error: string) => void): void;
  deleteStoredIdentity(success: () => void, failure: (error: string) => void): void;
  sdkVersion(): string;
}
