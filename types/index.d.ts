export { Fingerly, requireFingerly, type FingerlySpec } from '../generated/Fingerly';
export {
  ConsentError,
  FingerlyClient,
  FingerlyError,
  /**
   * Strictly for user-initiated GDPR / privacy right-to-erasure requests or
   * account deletion (never routine logout). Deletes the local `install_id`
   * record and hardware attestation key state on the device.
   */
  deleteStoredIdentity,
  load,
  nativeVersion,
} from '../src/index';
/**
 * Named constants for the fixed values the API returns and the module accepts,
 * the same objects `@fingerly/web-js` exports. Each is also the type of its
 * values.
 */
export {
  Confidence,
  ConsentState,
  EventState,
  SdkPlatform,
  Signal,
  SuspectLevel,
} from '../src/index';
export type {
  EngineIdentity,
  FingerlyOptions,
  IdentifyOptions,
  IdentifyResult,
  IdentifySubmission,
  IdentifyTrigger,
  IntegrityReport,
  Lie,
  LieKind,
  MobileFingerlyOptions,
  MobileIdentifyOptions,
  NativeIdentifyResult,
  RawReportResult,
  RiskSignal,
  SignalName,
  SignalOutcome,
  SignalReport,
  SignalStatus,
} from '../src/index';
