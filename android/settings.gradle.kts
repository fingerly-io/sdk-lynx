pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
  plugins {
    id("com.android.library") version "8.11.1"
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
  repositories {
    mavenLocal()
    google()
    mavenCentral()
    maven("https://maven.fingerly.io")
  }
}

rootProject.name = "fingerly-lynx"
