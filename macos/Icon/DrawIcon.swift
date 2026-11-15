// Draws the Public Desk app icon as a 1024 × 1024 PNG. It is the brand mark from the app's sidebar (`.brand-mark` in
// public/ui.css): a bold italic Georgia "P" in navy on a silver gradient tile. Run by scripts/build-menu-bar-app.zsh,
// which turns the PNG into AppIcon.icns. Drawn with Core Graphics and Core Text only, so it needs no image files or
// design tools; Georgia comes with macOS.
//   swiftc -o draw-icon macos/Icon/DrawIcon.swift && ./draw-icon AppIcon.png

import CoreGraphics
import CoreText
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

// The tile follows Apple's icon grid: 824 px with a 100 px margin, where the soft shadow sits, and the corner radius
// macOS uses so the icon matches others in the Dock (the sidebar's 10 px on 33 px is a little rounder).
let tileRect = CGRect(x: 100, y: 100, width: 824, height: 824)
let tile = CGPath(roundedRect: tileRect, cornerWidth: 185, cornerHeight: 185, transform: nil)
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -14), blur: 34, color: color(0x000000, 0.3))
context.addPath(tile)
context.setFillColor(color(0xD6DEEB))
context.fillPath()
context.restoreGState()

// background: linear-gradient(145deg, #fff, #aebbd3 45%, #fff), mapped onto the tile the way CSS does it: the
// gradient line runs through the centre at 145° (down and to the right) and is long enough to reach both corners.
let radians = 145 * CGFloat.pi / 180
let direction = CGVector(dx: sin(radians), dy: cos(radians)) // y up: 145° points down-right
let length = tileRect.width * abs(sin(radians)) + tileRect.height * abs(cos(radians))
let center = CGPoint(x: tileRect.midX, y: tileRect.midY)
let start = CGPoint(x: center.x - direction.dx * length / 2, y: center.y - direction.dy * length / 2)
let end = CGPoint(x: center.x + direction.dx * length / 2, y: center.y + direction.dy * length / 2)
context.saveGState()
context.addPath(tile)
context.clip()
let silver = CGGradient(colorsSpace: space, colors: [color(0xFFFFFF), color(0xAEBBD3), color(0xFFFFFF)] as CFArray,
                        locations: [0, 0.45, 1])!
context.drawLinearGradient(silver, start: start, end: end, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
context.restoreGState()

// The letter: Georgia Bold Italic (font-weight 750, italic), 18 px on a 33 px tile, in #082767. Like the browser, it is
// centred on its line box and advance width rather than its ink, so it sits where it does in the sidebar.
let fontSize = tileRect.width * 18 / 33
let font = CTFontCreateWithName("Georgia-BoldItalic" as CFString, fontSize, nil)
let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(0x082767)
]
let line = CTLineCreateWithAttributedString(NSAttributedString(string: "P", attributes: attributes))
var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
let advance = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
context.textPosition = CGPoint(x: center.x - advance / 2, y: center.y - (ascent + descent) / 2 + descent)
CTLineDraw(line, context)

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL,
                                                        "public.png" as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, image, nil)
exit(CGImageDestinationFinalize(destination) ? 0 : 1)
