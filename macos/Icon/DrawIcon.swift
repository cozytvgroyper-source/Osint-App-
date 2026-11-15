// Draws the Public Desk app icon as a 1024 × 1024 PNG: a magnifying glass over a document on a navy tile.
// Run by scripts/build-menu-bar-app.zsh, which turns the PNG into AppIcon.icns. Drawn with Core Graphics only, so the
// icon needs no image files, design tools or SF Symbols (whose license does not cover app icons).
//   swiftc -o draw-icon macos/Icon/DrawIcon.swift && ./draw-icon AppIcon.png

import CoreGraphics
import Foundation
import ImageIO

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("Usage: draw-icon <output.png>\n".utf8))
    exit(2)
}

let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: space, components: [CGFloat((hex >> 16) & 0xff) / 255, CGFloat((hex >> 8) & 0xff) / 255,
                                            CGFloat(hex & 0xff) / 255, alpha])!
}

func roundedRect(_ rect: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

// The tile: Apple's icon grid leaves a 100 px margin on a 1024 canvas; the soft shadow sits in that margin.
let tile = roundedRect(CGRect(x: 100, y: 100, width: 824, height: 824), 185)
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.35))
context.addPath(tile)
context.setFillColor(color(0x173563))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(tile)
context.clip()
let background = CGGradient(colorsSpace: space, colors: [color(0x2D5FA8), color(0x12284D)] as CFArray,
                            locations: [0, 1])!
context.drawLinearGradient(background, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
context.restoreGState()

// The document: a white page with a headline and lines of text, tilted slightly.
context.saveGState()
context.translateBy(x: 450, y: 545)
context.rotate(by: 4 * .pi / 180)
context.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: color(0x000000, 0.3))
context.addPath(roundedRect(CGRect(x: -215, y: -275, width: 430, height: 550), 42))
context.setFillColor(color(0xFFFFFF))
context.fillPath()
context.setShadow(offset: .zero, blur: 0, color: nil)
context.addPath(roundedRect(CGRect(x: -160, y: 170, width: 320, height: 46), 23))
context.setFillColor(color(0x1E3A6E))
context.fillPath()
for (index, width) in [320, 300, 320, 240, 280].enumerated() {
    context.addPath(roundedRect(CGRect(x: -160, y: 100 - CGFloat(index) * 62, width: CGFloat(width), height: 26), 13))
}
context.setFillColor(color(0xC9D3E3))
context.fillPath()
context.restoreGState()

// The magnifying glass: an amber ring with a tinted lens and a handle running down to the right.
let lensCenter = CGPoint(x: 590, y: 440)
let lensRadius: CGFloat = 165
let angle = -45 * CGFloat.pi / 180
let handleStart = CGPoint(x: lensCenter.x + cos(angle) * (lensRadius + 10), y: lensCenter.y + sin(angle) * (lensRadius + 10))
let handleEnd = CGPoint(x: lensCenter.x + cos(angle) * (lensRadius + 175), y: lensCenter.y + sin(angle) * (lensRadius + 175))

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -10), blur: 26, color: color(0x000000, 0.4))
context.setLineCap(.round)
context.setLineWidth(78)
context.setStrokeColor(color(0xD9891A))
context.move(to: handleStart)
context.addLine(to: handleEnd)
context.strokePath()
context.restoreGState()

context.addEllipse(in: CGRect(x: lensCenter.x - lensRadius, y: lensCenter.y - lensRadius,
                              width: lensRadius * 2, height: lensRadius * 2))
context.setFillColor(color(0xBFE3FF, 0.35))
context.fillPath()

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -8), blur: 20, color: color(0x000000, 0.35))
context.setLineWidth(52)
context.setStrokeColor(color(0xF6B940))
context.addEllipse(in: CGRect(x: lensCenter.x - lensRadius, y: lensCenter.y - lensRadius,
                              width: lensRadius * 2, height: lensRadius * 2))
context.strokePath()
context.restoreGState()

// A highlight on the glass.
context.setLineCap(.round)
context.setLineWidth(22)
context.setStrokeColor(color(0xFFFFFF, 0.75))
context.addArc(center: lensCenter, radius: lensRadius - 62, startAngle: 115 * .pi / 180, endAngle: 165 * .pi / 180,
               clockwise: false)
context.strokePath()

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL,
                                                        "public.png" as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, image, nil)
exit(CGImageDestinationFinalize(destination) ? 0 : 1)
