<?php

namespace MyApp;

use MyApp\Helper;
use MyApp\Other as OtherThing;

/**
 * Adds two ints.
 */
function add($a, $b) {
    return $a + $b;
}

class Point {
    public $x;
    public $y;

    public function __construct($x, $y) {
        $this->x = $x;
        $this->y = $y;
    }

    public function sum() {
        return $this->x + $this->y;
    }

    private function hidden() {
        return 0;
    }
}

interface Shape {
    public function area();
}
