use std::{env, path::PathBuf, process::Command};
fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var("OUT_DIR").unwrap());
        let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let target = if arch == "aarch64" { "arm64-apple-macosx13.0" } else { "x86_64-apple-macosx13.0" };
        let sources = ["../ios/VibeWord/Core/Localization.swift", "../ios/VibeWord/Core/EnglishMessages.swift", "../ios/VibeWord/Core/Models.swift", "../ios/VibeWord/Core/FSRSVendor.swift", "../ios/VibeWord/Core/FSRSScheduler.swift", "../ios/VibeWord/Core/Anki.swift", "../ios/VibeWord/Core/SyncEvent.swift",
                       "../ios/VibeWord/Core/JSONEventStore.swift", "../ios/VibeWord/App/FolderSync.swift",
                       "../ios/VibeWord/App/LegacyCoreDataImport.swift", "../ios/VibeWord/App/Persistence.swift", "macos/LegacyImport.swift", "macos/DocumentImport.swift", "macos/TextImport.swift", "macos/AnkiImport.swift", "macos/CloudBridge.swift"];
        for source in sources { println!("cargo:rerun-if-changed={source}"); }
        let status = Command::new("xcrun").args(["swiftc", "-emit-library", "-static", "-O", "-swift-version", "5",
            "-module-name", "VibeWordCloud", "-target", target, "-module-cache-path"])
            .arg(out.join("swift-cache")).args(sources).arg("-o").arg(out.join("libVibeWordCloud.a"))
            .status().expect("Xcode Swift compiler required for macOS");
        assert!(status.success(), "Swift JSON storage bridge failed to compile");
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=VibeWordCloud");
        // The Swift runtime is part of macOS; swiftc's autolink entries require its search path.
        let swift = Command::new("xcrun").args(["--find", "swiftc"]).output().unwrap();
        let swift = PathBuf::from(String::from_utf8(swift.stdout).unwrap().trim());
        println!("cargo:rustc-link-search=native={}", swift.parent().unwrap().join("../lib/swift/macosx").display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        for framework in ["PDFKit", "Foundation", "CoreData", "AppKit", "Security", "Combine", "UniformTypeIdentifiers", "CryptoKit"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-lib=sqlite3");
    }
    tauri_build::build()
}
