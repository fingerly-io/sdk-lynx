#
# The native SDK comes in as a vendored XCFramework from Fingerly's own host
# rather than as `s.dependency 'Fingerly'`, because CocoaPods trunk accepts no
# new podspecs after 2026-12-02.
#
# The fetch runs while the podspec is evaluated, not as a `prepare_command`:
# CocoaPods skips the prepare step for a pod it considers unchanged, so
# reinstalling node_modules would leave the framework missing for good. The
# script does nothing once the right binary is in place.
#
require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
binary = JSON.parse(File.read(File.join(__dir__, 'fingerly-binary.json')))

unless system('bash', File.join(__dir__, 'fetch-fingerly-xcframework.sh'),
              binary['version'], binary['sha256'].to_s, __dir__)
  raise "Could not fetch Fingerly.xcframework #{binary['version']}. See the message above."
end

Pod::Spec.new do |s|
  s.name = 'fingerly-lynx'
  s.version = package['version']
  s.summary = 'Fingerly native bridge for Lynx'
  s.homepage = 'https://fingerly.io'
  s.license = { :type => 'Apache-2.0', :file => '../LICENSE' }
  s.author = 'Fingerly'
  s.platform = :ios, '13.0'
  s.swift_version = '5.9'
  # The Lynx autolinker installs this pod by path and never reads the source.
  # It names the published tarball so the field still points at something public.
  s.source = { :http => "https://registry.npmjs.org/@fingerly/lynx/-/lynx-#{s.version}.tgz" }
  s.source_files = 'src/**/*.{h,m,mm}'
  s.vendored_frameworks = 'Frameworks/Fingerly.xcframework'
  s.dependency 'Lynx', '4.1.0'
end
