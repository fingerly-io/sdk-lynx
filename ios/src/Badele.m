#import "Badele.h"
#import <Badele/Badele-Swift.h>

@implementation Badele

+ (NSString *)name {
  return @"Badele";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"configure" : NSStringFromSelector(@selector(configure:endpoint:platform:)),
    @"identify" : NSStringFromSelector(@selector(identify:submit:success:failure:)),
    @"collect" : NSStringFromSelector(@selector(collect:failure:)),
    @"sdkVersion" : NSStringFromSelector(@selector(sdkVersion)),
  };
}

- (void)configure:(NSString *)apiKey endpoint:(NSString *)endpoint platform:(NSString *)platform {
  [BadeleBridge configureWithApiKey:apiKey endpoint:endpoint platform:platform];
}

- (void)identify:(nullable NSString *)tag
          submit:(BOOL)submit
         success:(id)success
         failure:(id)failure {
  void (^successCallback)(id) = (void (^)(id))success;
  void (^failureCallback)(id) = (void (^)(id))failure;
  [BadeleBridge identifyWithTag:tag submit:submit completion:^(NSString *json, NSError *error) {
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
  [BadeleBridge collectWithCompletion:^(NSString *json, NSError *error) {
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
  return BadeleBridge.sdkVersion;
}

- (NSString *)errorJSON:(NSError *)error {
  NSDictionary *payload = @{
    @"code" : [NSString stringWithFormat:@"%ld", (long)error.code],
    @"message" : error.localizedDescription ?: @"Native SDK failure",
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
    ?: @"{\"code\":\"-1\",\"message\":\"Native SDK failure\"}";
}

@end
