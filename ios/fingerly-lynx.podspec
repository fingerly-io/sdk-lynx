Pod::Spec.new do |s|
  s.name = 'fingerly-lynx'
  s.version = '0.0.0'
  s.summary = 'Fingerly native bridge for Lynx'
  s.homepage = 'https://github.com/fingerly-io/sdk-lynx'
  s.license = { :type => 'Apache-2.0', :file => '../LICENSE' }
  s.author = 'Fingerly'
  s.platform = :ios, '13.0'
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/fingerly-io/sdk-lynx.git', :tag => s.version.to_s }
  s.source_files = 'src/**/*.{h,m,mm}'
  s.dependency 'Lynx', '4.1.0'
  s.dependency 'Fingerly', '~> 0.1'
end
