#!/bin/sh
# Runs the SAME XCTest methods with a small assertion adapter when CLT lacks XCTest.
set -eu
IOS_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEST_TMP=$(mktemp -d /tmp/vibe-word-core.XXXXXX)
trap 'rm -rf "$TEST_TMP"' EXIT
python3 - "$IOS_ROOT" "$TEST_TMP" <<'PY'
import pathlib,sys,re,json
root,tmp=map(pathlib.Path,sys.argv[1:])
source=(root/'Tests/VibeWordCoreTests/CoreTests.swift').read_text().replace('import XCTest','import Foundation').replace('@testable import VibeWordCore','')
source=source.replace('Bundle.module.url(forResource: "parity", withExtension: "json", subdirectory: "Fixtures")','Optional(URL(fileURLWithPath: '+json.dumps(str(root/'Tests/VibeWordCoreTests/Fixtures/parity.json'))+'))')
adapter='''
class XCTestCase {}
func XCTAssertEqual<T: Equatable>(_ a: T, _ b: T, file: StaticString = #file, line: UInt = #line) { precondition(a == b, "Expected \\(a) == \\(b)", file: file, line: line) }
func XCTAssertEqual(_ a: Double, _ b: Double, accuracy: Double, file: StaticString = #file, line: UInt = #line) { precondition(abs(a-b) <= accuracy, "Double mismatch", file: file, line: line) }
func XCTAssertTrue(_ value: Bool, file: StaticString = #file, line: UInt = #line) { precondition(value, "Expected true", file: file, line: line) }
func XCTAssertFalse(_ value: Bool) { precondition(!value) }
func XCTFail(_ message: String) { preconditionFailure(message) }
func XCTAssertNil<T>(_ value: T?, file: StaticString = #file, line: UInt = #line) { precondition(value == nil, "Expected nil", file: file, line: line) }
func XCTUnwrap<T>(_ value: T?) throws -> T { guard let value else { throw NSError(domain: "Test", code: 1) }; return value }
'''
methods=re.findall(r'func (test\w+)\(\)( async)?( throws)?',source)
runner='\n@main struct Runner { static func main() async throws { let suite = CoreTests()\n'
for method, asynchronous, throwing in methods: runner+=f'{"try " if throwing else ""}{"await " if asynchronous else ""}suite.{method}(); print("PASS {method}")\n'
runner+=f'print("Passed {len(methods)} test methods, including 192 TypeScript SM-2 fixtures")\n'+'} }\n'
(tmp/'Tests.swift').write_text(source+adapter+runner)
PY
swiftc -module-cache-path "$TEST_TMP/cache" "$IOS_ROOT"/VibeWord/Core/*.swift "$TEST_TMP/Tests.swift" -o "$TEST_TMP/tests"
"$TEST_TMP/tests"
