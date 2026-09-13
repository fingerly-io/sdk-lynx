Pod::Spec.new do |s|
  s.name = 'badele-lynx'
  s.version = '0.0.0'
  s.summary = 'Badele native bridge for Lynx'
  s.homepage = 'https://github.com/badele-io/sdk-lynx'
  s.license = { :type => 'Proprietary' }
  s.author = 'Badele'
  s.platform = :ios, '13.0'
  s.source = { :git => 'https://github.com/badele-io/sdk-lynx.git', :tag => s.version.to_s }
  s.source_files = 'src/**/*.{h,m,mm}'
  s.dependency 'Lynx', '4.1.0'
  s.dependency 'Badele', '~> 0.1'
end
