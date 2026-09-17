Pod::Spec.new do |s|
  s.name = 'RnDevice'
  s.version = '0.1.0'
  s.summary = 'Race Navigator device access for the RN Analyzer app'
  s.license = 'MIT'
  s.homepage = 'https://github.com/maxzmacrix/rnanalyzer'
  s.author = 'RN Vision GmbH'
  s.source = { :git => 'https://github.com/maxzmacrix/rnanalyzer.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.dependency 'PostgresClientKit', '~> 1.5'
  s.swift_version = '5.1'
end
