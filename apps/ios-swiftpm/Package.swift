// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SenroMusic",
    platforms: [
        .iOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "SenroMusicApp",
            path: "Sources/SenroMusicApp"
        )
    ]
)
