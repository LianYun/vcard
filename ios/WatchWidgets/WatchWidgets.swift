import SwiftUI
import WidgetKit

struct StudyEntry: TimelineEntry {
    var date: Date
    var summary: WatchSummary
}
struct StudyProvider: TimelineProvider {
    func placeholder(in context: Context) -> StudyEntry {
        StudyEntry(date: Date(), summary: WatchSummary(updatedAt: Date(), syncedAt: Date(), dueDates: Array(repeating: Day.key(), count: 18), remainingInRound: 0, pendingCount: 0))
    }
    func getSnapshot(in context: Context, completion: @escaping (StudyEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : StudyEntry(date: Date(), summary: .load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<StudyEntry>) -> Void) {
        let now = Date(), summary = WatchSummary.load()
        let midnight = Day.calendar.startOfDay(for: now)
        let tomorrow = Day.calendar.date(byAdding: .day, value: 1, to: midnight)!
        // A midnight entry updates the due count even if the phone stays offline.
        completion(Timeline(entries: [StudyEntry(date: now, summary: summary), StudyEntry(date: tomorrow, summary: summary)],
                            policy: .after(tomorrow.addingTimeInterval(60))))
    }
}
struct StudyWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StudyEntry
    private var count: Int { entry.summary.due(on: Day.key(entry.date)) }
    var body: some View {
        Group {
            switch family {
            case .accessoryCircular:
                VStack(spacing: 0) {
                    Image(systemName: "rectangle.on.rectangle")
                    Text(entry.summary.syncedAt == nil ? "—" : "\(count)").font(.headline)
                }
            case .accessoryInline:
                Text(entry.summary.syncedAt == nil ? L("Vibe Word · 打开同步") : L("Vibe Word · {0} 张待复习", "\(count)"))
            default:
                VStack(alignment: .leading, spacing: 3) {
                    Text("VIBE WORD").font(.caption2).foregroundStyle(.secondary)
                    Text(entry.summary.syncedAt == nil ? L("打开手表，同步卡片") : L("{0} 张，等你想起。", "\(count)")).font(.headline)
                    Text(entry.summary.remainingInRound > 0 ? L("继续本轮学习") : L("开始一轮复习")).font(.caption2)
                }
            }
        }
        .containerBackground(.black, for: .widget)
        .widgetURL(URL(string: "vibeword://study"))
        .accessibilityLabel(entry.summary.syncedAt == nil ? L("Vibe Word，打开同步") : L("Vibe Word，{0} 张待复习，点击开始", "\(count)"))
    }
}
@main
struct VibeWordWatchWidgets: Widget {
    let kind = "VibeWordStudy"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StudyProvider()) { StudyWidgetView(entry: $0) }
            .configurationDisplayName(L("腕间拾词"))
            .description(L("查看已缓存的待复习卡片，点击开始一轮学习。"))
            .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
