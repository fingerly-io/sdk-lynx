plugins {
  id("com.android.library")
}

repositories {
  mavenLocal()
  google()
  mavenCentral()
  maven("https://maven.fingerly.io")
}

android {
  namespace = "io.fingerly.lynx"
  compileSdk = 36

  defaultConfig {
    minSdk = 23
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
  }
}

dependencies {
  implementation("androidx.annotation:annotation:1.9.1")
  implementation("org.lynxsdk.lynx:lynx:4.1.0")
  implementation("org.lynxsdk.lynx:service-api:4.1.0")
  annotationProcessor("org.lynxsdk.lynx:lynx-processor:4.1.0")
  implementation("io.fingerly:fingerly:0.4.0")

  // The opt-in artifacts. `compileOnly` so the module can construct their providers when the
  // host app links them, without adding `<queries>` or Play Services to an app that does not.
  compileOnly("io.fingerly:fingerly-app-checks:0.4.0")
  compileOnly("io.fingerly:fingerly-play-integrity:0.4.0")

  testImplementation("junit:junit:4.13.2")
}

// The unit tests cover the plain Java helpers only. The Lynx runtime is native code that never
// loads on the JVM, so the tests run without it.
configurations
    .matching { it.name.endsWith("UnitTestRuntimeClasspath") }
    .configureEach { exclude(group = "org.lynxsdk.lynx") }
