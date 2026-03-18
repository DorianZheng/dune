// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "dune-host-operator-helper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "dune-host-operator-helper",
            dependencies: [],
            path: "Sources/dune-host-operator-helper",
            linkerSettings: [
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("AppKit"),
            ]
        ),
    ]
)
