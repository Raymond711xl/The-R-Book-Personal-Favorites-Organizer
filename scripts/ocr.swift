import AppKit
import Foundation
import Vision

struct OCRResult: Encodable {
    let text: String
    let lines: [String]
}

guard CommandLine.arguments.count == 2 else {
    fputs("usage: the-r-book-personal-favorites-organizer-ocr /absolute/path/to/image\n", stderr)
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard
    let image = NSImage(contentsOf: imageURL),
    let imageData = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: imageData),
    let cgImage = bitmap.cgImage
else {
    fputs("cannot decode image\n", stderr)
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
    let observations = request.results ?? []
    let lines = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
    let result = OCRResult(text: lines.joined(separator: "\n"), lines: lines)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    FileHandle.standardOutput.write(try encoder.encode(result))
} catch {
    fputs("OCR failed: \(error.localizedDescription)\n", stderr)
    exit(4)
}
