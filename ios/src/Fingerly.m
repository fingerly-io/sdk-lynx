#import "Fingerly.h"
#import <Fingerly/Fingerly-Swift.h>

@implementation Fingerly

+ (NSString *)name {
  return @"Fingerly";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"configure" : NSStringFromSelector(@selector(configure:endpoint:platform:consent:playIntegrityCloudProjectNumber:)),
    @"setConsent" : NSStringFromSelector(@selector(setConsent:)),
    @"identify" : NSStringFromSelector(@selector(identify:submit:automatic:success:failure:)),
    @"collect" : NSStringFromSelector(@selector(collect:failure:)),
    @"deleteStoredIdentity" : NSStringFromSelector(@selector(deleteStoredIdentity:failure:)),
    @"sdkVersion" : NSStringFromSelector(@selector(sdkVersion)),
  };
}

- (void)configure:(NSString *)apiKey
                           endpoint:(NSString *)endpoint
                           platform:(NSString *)platform
                            consent:(NSString *)consent
    playIntegrityCloudProjectNumber:(double)playIntegrityCloudProjectNumber {
  // `src/index.ts` always sends a consent, `pending` when the app passed none.
  // The native bridge reads anything it does not recognise as `pending`.
  // The Play Integrity project number is Android only and not read here.
  [FingerlyBridge configureWithApiKey:apiKey endpoint:endpoint platform:platform consent:consent];
}

- (void)setConsent:(NSString *)state {
  [FingerlyBridge setConsent:state];
}

- (void)identify:(nullable NSString *)tag
          submit:(BOOL)submit
       automatic:(BOOL)automatic
         success:(id)success
         failure:(id)failure {
  void (^successCallback)(id) = (void (^)(id))success;
  void (^failureCallback)(id) = (void (^)(id))failure;
  // `automatic` marks a call the app made on its own, which joins the
  // identification already in flight instead of starting another.
  [FingerlyBridge identifyWithTag:tag
                           submit:submit
                        automatic:automatic
                       completion:^(NSString *json, NSError *error) {
    if (error != nil) {
      failureCallback([self errorJSON:error]);
    } else if (json != nil) {
      successCallback(json);
    } else {
      failureCallback(@"{\"code\":\"-1\",\"message\":\"The SDK produced no report\"}");
    }
  }];
}

- (void)collect:(id)success failure:(id)failure {
  void (^successCallback)(id) = (void (^)(id))success;
  void (^failureCallback)(id) = (void (^)(id))failure;
  [FingerlyBridge collectWithCompletion:^(NSString *json, NSError *error) {
    if (error != nil) {
      failureCallback([self errorJSON:error]);
    } else if (json != nil) {
      successCallback(json);
    } else {
      failureCallback(@"{\"code\":\"-1\",\"message\":\"The SDK produced no report\"}");
    }
  }];
}

- (void)deleteStoredIdentity:(id)success failure:(id)failure {
  // A keychain delete, synchronous and quick. A refusal carries the
  // `delete_failed` code in `userInfo`, which `errorJSON:` passes on.
  //
  // Both are Lynx callback blocks, `void (^)(id result)`, and are called with
  // their one argument. Calling the success block through a zero-argument
  // cast would hand Lynx whatever the argument register held as `result`,
  // which it retains and converts to a JavaScript value.
  void (^successCallback)(id) = (void (^)(id))success;
  void (^failureCallback)(id) = (void (^)(id))failure;
  NSError *error = [FingerlyBridge deleteStoredIdentity];
  if (error != nil) {
    failureCallback([self errorJSON:error]);
  } else {
    successCallback(nil);
  }
}

- (NSString *)sdkVersion {
  return FingerlyBridge.sdkVersion;
}

- (NSString *)errorJSON:(NSError *)error {
  // A refusal for want of consent carries its string code (`consent_required`)
  // and the refusing state in `userInfo`; every other failure uses the numeric
  // code, which is the HTTP status where there was one.
  id userInfoCode = error.userInfo[@"code"];
  id userInfoState = error.userInfo[@"state"];
  NSMutableDictionary *payload = [@{
    @"code" : [userInfoCode isKindOfClass:[NSString class]]
      ? userInfoCode
      : [NSString stringWithFormat:@"%ld", (long)error.code],
    @"message" : error.localizedDescription ?: @"Native SDK failure",
  } mutableCopy];
  if ([userInfoState isKindOfClass:[NSString class]]) {
    payload[@"state"] = userInfoState;
  }
  // The wait a 429 or 503 named in `Retry-After`, when the native bridge
  // passed one on; `src/index.ts` reads it into `retryAfterMs`.
  id userInfoRetryAfter = error.userInfo[@"retryAfterMs"];
  if ([userInfoRetryAfter isKindOfClass:[NSNumber class]]) {
    payload[@"retryAfterMs"] = userInfoRetryAfter;
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
    ?: @"{\"code\":\"-1\",\"message\":\"Native SDK failure\"}";
}

@end
