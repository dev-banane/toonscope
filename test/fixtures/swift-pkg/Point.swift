import Foundation

/// Adds two ints.
func add(a: Int, b: Int) -> Int {
    return a + b
}

private func secret() -> Int {
    return 0
}

class Point {
    var x: Int
    var y: Int

    init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }

    func sum() -> Int {
        return x + y
    }
}

struct Size {
    var w: Int
    var h: Int
}

protocol Shape {
    func area() -> Double
}

enum Color {
    case red, green, blue
}
