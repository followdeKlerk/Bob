// Test APK's minimal RN core-module binding; no application-specific C++ codegen.
#include <DefaultTurboModuleManagerDelegate.h>
#include <FBReactNativeSpec.h>
#include <fbjni/fbjni.h>
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    facebook::react::DefaultTurboModuleManagerDelegate::javaModuleProvider =
        &facebook::react::FBReactNativeSpec_ModuleProvider;
  });
}
