plugins {
  id("com.android.library")
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
  implementation("io.fingerly:fingerly:0.2.0")
}
