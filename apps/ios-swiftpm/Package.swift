// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Norie Music",
    platforms: [
        .iOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "Norie MusicApp",
            path: "Sources/Norie MusicApp"
        )
    ]
)
