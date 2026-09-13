#import <Foundation/Foundation.h>
#import <Lynx/LynxModule.h>
#import "BadeleSpec.h"

NS_ASSUME_NONNULL_BEGIN

@LynxNativeModule("Badele")
@interface Badele : NSObject <BadeleSpec>

@end

NS_ASSUME_NONNULL_END
