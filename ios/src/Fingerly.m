#import "Fingerly.h"
#import <Fingerly/Fingerly-Swift.h>

@implementation Fingerly

+ (NSString *)name {
  return @"Fingerly";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"configure" : NSStringFromSelector(@selector(configure:endpoint:platform:consent:)),
    @"setConsent" : NSStringFromSelector(@selector(setConsent:)),
    @"identify" : NSStringFromSelector(@selector(identify:submit:success:failure:)),
    @"collect" : NSStringFromSelector(@selector(collect:failure:)),
    @"sdkVersion" : NSStringFromSelector(@selector(sdkVersion)),
  };
}

- (void)configure:(NSString *)apiKey
         endpoint:(NSString *)endpoint
         platform:(NSString *)platform
          consent:(NSString *)consent {
  // `src/index.ts` always sends a consent, `pending` when the app passed none.
  // The native bridge reads anything it does not recognise as `pending`.
  [FingerlyBridge configureWithApiKey:apiKey endpoint:endpoint platform:platform consent:consent];
}

- (void)setConsent:(NSString *)state {
  [FingerlyBridge setConsent:state];
}

- (void)identify:(nullable NSString *)tag
          submit:(BOOL)submit
         success:(id)success
         failure:(id)failure {
  void (^successCallback)(id) = (void (^)(id))success;
  void (^failureCallback)(id) = (void (^)(id))failure;
  [FingerlyBridge identifyWithTag:tag submit:submit completion:^(NSString *json, NSError *error) {
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
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
    ?: @"{\"code\":\"-1\",\"message\":\"Native SDK failure\"}";
}

@end
