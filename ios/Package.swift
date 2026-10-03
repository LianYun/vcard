// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VibeWordCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "VibeWordCore", targets: ["VibeWordCore"])],
    targets: [
        .target(name: "VibeWordCore", path: "VibeWord/Core"),
        .testTarget(name: "VibeWordCoreTests", dependencies: ["VibeWordCore"], resources: [.copy("Fixtures")])
    ]
)
