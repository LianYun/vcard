// Vendored open-spaced-repetition/swift-fsrs. See docs/FSRS-DEPENDENCIES.md.
/*
MIT License

Copyright (c) 2023 Ben Smiley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// Upstream: Sources/FSRS/Algorithm/FSRS.swift
//
//  FSRS.swift
//
//  Created by nkq on 10/13/24.
//

import Foundation

public final class FSRS: FSRSAlgorithm, @unchecked Sendable {

    override public init(parameters: FSRSParameters) {
        super.init(parameters: parameters)
    }

    /**
     * Display the collection of cards and logs for the four scenarios after scheduling the card at the current time.
     * @param card VendorFSRSCard to be processed
     * @param now Current time or scheduled time
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```
     * const card: VendorFSRSCard = createEmptyCard(new Date());
     * const f = fsrs();
     * const recordLog = f.repeat(card, new Date());
     * ```
     * @example
     * ```
     * interface RevLogUnchecked
     *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
     *   cid: string;
     *   due: Date | number;
     *   state: StateType;
     *   review: Date | number;
     *   rating: RatingType;
     * }
     *
     * interface RepeatRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked;
     * }
     *
     * function repeatAfterHandler(recordLog: RecordLog) {
     *     const record: { [key in Grade]: RepeatRecordLog } = {} as {
     *       [key in Grade]: RepeatRecordLog;
     *     };
     *     for (const grade of Grades) {
     *       record[grade] = {
     *         card: {
     *           ...(recordLog[grade].card as VendorFSRSCard & { cid: string }),
     *           due: recordLog[grade].card.due.getTime(),
     *           state: State[recordLog[grade].card.state] as StateType,
     *           last_review: recordLog[grade].card.last_review
     *             ? recordLog[grade].card.last_review!.getTime()
     *             : null,
     *         },
     *         log: {
     *           ...recordLog[grade].log,
     *           cid: (recordLog[grade].card as VendorFSRSCard & { cid: string }).cid,
     *           due: recordLog[grade].log.due.getTime(),
     *           review: recordLog[grade].log.review.getTime(),
     *           state: State[recordLog[grade].log.state] as StateType,
     *           rating: Rating[recordLog[grade].log.rating] as RatingType,
     *         },
     *       };
     *     }
     *     return record;
     * }
     * const card: VendorFSRSCard = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
     * const f = fsrs();
     * const recordLog = f.repeat(card, new Date(), repeatAfterHandler);
     * ```
     */
    public func `repeat`(
        card: VendorFSRSCard,
        now: Date,
        _ completion: ((_ log: IPreview) -> IPreview)? = nil
    ) throws -> IPreview {
        let obj = scheduler(for: card, reviewTime: now)
        let log = try obj.preview
        if let completion = completion {
            return completion(log)
        } else {
            return log
        }
    }

    /**
     * Display the collection of cards and logs for the card scheduled at the current time, after applying a specific grade rating.
     * @param card VendorFSRSCard to be processed
     * @param now Current time or scheduled time
     * @param grade Rating of the review (Again, Hard, Good, Easy)
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```
     * const card: VendorFSRSCard = createEmptyCard(new Date());
     * const f = fsrs();
     * const recordLogItem = f.next(card, new Date(), Rating.Again);
     * ```
     * @example
     * ```
     * interface RevLogUnchecked
     *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
     *   cid: string;
     *   due: Date | number;
     *   state: StateType;
     *   review: Date | number;
     *   rating: RatingType;
     * }
     *
     * interface NextRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked;
     * }
     *
     function nextAfterHandler(recordLogItem: RecordLogItem) {
     const recordItem = {
     card: {
     ...(recordLogItem.card as VendorFSRSCard & { cid: string }),
     due: recordLogItem.card.due.getTime(),
     state: State[recordLogItem.card.state] as StateType,
     last_review: recordLogItem.card.last_review
     ? recordLogItem.card.last_review!.getTime()
     : null,
     },
     log: {
     ...recordLogItem.log,
     cid: (recordLogItem.card as VendorFSRSCard & { cid: string }).cid,
     due: recordLogItem.log.due.getTime(),
     review: recordLogItem.log.review.getTime(),
     state: State[recordLogItem.log.state] as StateType,
     rating: Rating[recordLogItem.log.rating] as RatingType,
     },
     };
     return recordItem
     }
     * const card: VendorFSRSCard = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
     * const f = fsrs();
     * const recordLogItem = f.repeat(card, new Date(), Rating.Again, nextAfterHandler);
     * ```
     */
    public func next(
        card: VendorFSRSCard,
        now: Date,
        grade: Rating,
        completion: ((_ log: RecordLogItem) -> RecordLogItem)? = nil
    ) throws -> RecordLogItem {
        if grade == .manual {
            throw FSRSError(.invalidRating, "Cannot review a manual rating")
        }
        let obj = scheduler(for: card, reviewTime: now)
        let log = try obj.review(grade)
        if let completion = completion {
            return completion(log)
        } else {
            return log
        }
    }

    /// Picks the appropriate scheduler for the active algorithm version and
    /// `enableShortTerm` setting:
    /// - `enableShortTerm == false`: shared `LongTermScheduler` (works for both
    ///   v5 and v6 because long-term mode collapses w17/w18 to 0).
    /// - `v5 + enableShortTerm`: legacy `BasicScheduler` (hardcoded 1m/5m/10m).
    /// - `v6 + enableShortTerm`: `BasicSchedulerV6` (configurable steps,
    ///   delegates state transitions to `algorithm.nextState`).
    private func scheduler(for card: VendorFSRSCard, reviewTime: Date) -> AbstractScheduler {
        if !params.enableShortTerm {
            return LongTermScheduler(card: card, reviewTime: reviewTime, algorithm: self)
        }
        switch version {
        case .v5:
            return BasicScheduler(card: card, reviewTime: reviewTime, algorithm: self)
        case .v6:
            return BasicSchedulerV6(card: card, reviewTime: reviewTime, algorithm: self)
        }
    }

    /**
     * Get the retrievability of the card
     * @param card  VendorFSRSCard to be processed
     * @param now  Current time or scheduled time
     * @param format  default:true , Convert the result to another type. (Optional)
     * @returns  The retrievability of the card,if format is true, the result is a string, otherwise it is a number
     */
    public func getRetrievability(
        card: VendorFSRSCard,
        now: Date = Date()
    ) -> (string: String, number: Double) {
        let processed = card.newCard
        let time = processed.state != .new
        ? max(Date.dateDiff(now: now, pre: processed.lastReview, unit: .days), 0)
        : 0
        let retrievability = processed.state != .new
        ? forgettingCurve(elapsedDays: time, stability: processed.stability.toFixedNumber(8))
        : 0
        return ("\((retrievability * 100).toFixed(2))%", retrievability)
    }

    /**
     *
     * @param card VendorFSRSCard to be processed
     * @param log last review log
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now);
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now);
     * const { card, log } = repeatFormAfterHandler[Rating.Hard];
     * const rollbackFromAfterHandler = f.rollback(card, log);
     * ```
     *
     * @example
     * ```
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler);  //see method: createEmptyCard
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
     * const { card, log } = repeatFormAfterHandler[Rating.Hard];
     * const rollbackFromAfterHandler = f.rollback(card, log, cardAfterHandler);
     * ```
     */
    public func rollback(
        card: VendorFSRSCard,
        log: ReviewLog,
        completion: ((VendorFSRSCard) -> VendorFSRSCard)? = nil
    ) throws -> VendorFSRSCard {
        let processdCard = card.newCard
        let processedLog = log.newLog

        guard processedLog.rating != .manual else {
            throw FSRSError(.invalidRating, "Cannot rollback a manual rating")
        }
        var lastDue: Date, lastReview: Date?, lastLapses: Int
        guard let state = processedLog.state else {
            throw FSRSError(.invalidParam, "Rollback card must have a state")
        }
        switch state {
        case .new:
            guard let due = processedLog.due else {
                throw FSRSError(.invalidParam, "Rollback card must have a due date")
            }
            lastDue = due
            lastReview = nil
            lastLapses = 0
        case .learning, .review, .relearning:
            lastDue = processedLog.review
            lastReview = processedLog.due
            lastLapses = processdCard.lapses - (
                (processedLog.rating == .again && processedLog.state == .review) ? 1 : 0
            )
        }
        var previousCard = processdCard.newCard
        previousCard.due = lastDue
        previousCard.stability = processedLog.stability ?? 0
        previousCard.difficulty = processedLog.difficulty ?? 0
        previousCard.elapsedDays = processedLog.lastElapsedDays
        previousCard.scheduledDays = processedLog.scheduledDays
        previousCard.learningSteps = processedLog.learningSteps
        previousCard.reps = max(0, processdCard.reps - 1)
        previousCard.lapses = max(0, lastLapses)
        previousCard.state = state
        previousCard.lastReview = lastReview

        if let completion = completion {
            return completion(previousCard)
        } else {
            return previousCard
        }
    }

    /**
     *
     * @param card VendorFSRSCard to be processed
     * @param now Current time or scheduled time
     * @param reset_count Should the review count information(reps,lapses) be reset. (Optional)
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```
     * const now = new Date();
     * const f = fsrs();
     * const emptyCard = createEmptyCard(now);
     * const scheduling_cards = f.repeat(emptyCard, now);
     * const { card, log } = scheduling_cards[Rating.Hard];
     * const forgetCard = f.forget(card, new Date(), true);
     * ```
     *
     * @example
     * ```
     * interface RepeatRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked; //see method: fsrs.repeat()
     * }
     *
     * function forgetAfterHandler(recordLogItem: RecordLogItem): RepeatRecordLog {
     *     return {
     *       card: {
     *         ...(recordLogItem.card as VendorFSRSCard & { cid: string }),
     *         due: recordLogItem.card.due.getTime(),
     *         state: State[recordLogItem.card.state] as StateType,
     *         last_review: recordLogItem.card.last_review
     *           ? recordLogItem.card.last_review!.getTime()
     *           : null,
     *       },
     *       log: {
     *         ...recordLogItem.log,
     *         cid: (recordLogItem.card as VendorFSRSCard & { cid: string }).cid,
     *         due: recordLogItem.log.due.getTime(),
     *         review: recordLogItem.log.review.getTime(),
     *         state: State[recordLogItem.log.state] as StateType,
     *         rating: Rating[recordLogItem.log.rating] as RatingType,
     *       },
     *     };
     * }
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler); //see method:  createEmptyCard
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
     * const { card } = repeatFormAfterHandler[Rating.Hard];
     * const forgetFromAfterHandler = f.forget(card, date_scheduler(now, 1, true), false, forgetAfterHandler);
     * ```
     */
    public func forget(
        card: VendorFSRSCard,
        now: Date,
        resetCount: Bool = false,
        _ completion: ((_ recordLogItem: RecordLogItem) -> RecordLogItem)? = nil
    ) -> RecordLogItem {
        let processedCard = card.newCard
        let scheduledDay = processedCard.state == .new
        ? 0
        : Date.dateDiff(now: now, pre: processedCard.lastReview, unit: .days)
        let forgetLog = ReviewLog(
            rating: .manual,
            state: processedCard.state,
            due: processedCard.due,
            stability: processedCard.stability,
            difficulty: processedCard.difficulty,
            elapsedDays: 0,
            lastElapsedDays: processedCard.elapsedDays,
            scheduledDays: scheduledDay,
            review: now
        )
        let forgetCard = VendorFSRSCard(
            due: now,
            reps: resetCount ? 0 : processedCard.reps,
            lapses: resetCount ? 0 : processedCard.lapses,
            state: .new,
            lastReview: processedCard.lastReview
        )
        let log = RecordLogItem(card: forgetCard, log: forgetLog)
        if let completion = completion {
            return completion(log)
        } else {
            return log
        }
    }


    /**
     * Reschedules the current card and returns the rescheduled collections and reschedule item.
     *
     * @template T - The type of the record log item.
     * @param {CardInput | VendorFSRSCard} current_card - The current card to be rescheduled.
     * @param {Array<FSRSHistory>} reviews - The array of FSRSHistory objects representing the reviews.
     * @param {Partial<RescheduleOptions<T>>} options - The optional reschedule options.
     * @returns {IReschedule<T>} - The rescheduled collections and reschedule item.
     *
     * @example
     * ```
      const f = fsrs()
          const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Good, Rating.Good]
          const reviews_at = [
            new Date(2024, 8, 13),
            new Date(2024, 8, 13),
            new Date(2024, 8, 17),
            new Date(2024, 8, 28),
          ]

          const reviews: FSRSHistory[] = []
          for (let i = 0; i < grades.length; i++) {
            reviews.push({
              rating: grades[i],
              review: reviews_at[i],
            })
          }

          const results_short = scheduler.reschedule(
            createEmptyCard(),
            reviews,
            {
              skipManual: false,
            }
          )
          console.log(results_short)
     * ```
     */
    public func reschedule(
        currentCard: VendorFSRSCard,
        reviews: [ReviewLog],
        options: RescheduleOptions
    ) throws -> IReschedule {
        var reviews = reviews
        if let sortOrder = options.reviewsOrderBy {
            reviews.sort(by: sortOrder)
        }
        if options.skipManual {
            reviews = reviews.filter({ $0.rating != .manual })
        }
        let rescheduleSvc = FSRSReschedule(fsrs: self)
        let items = try rescheduleSvc.reschedule(
            currentCard: options.firstCard ?? FSRSDefaults().createEmptyCard(),
            reviews: reviews
        )

        let curCard = currentCard.newCard
        let manualItem = try rescheduleSvc.calculateManualRecord(
            currentCard: curCard,
            now: options.now,
            recordLogItem: items.last ?? nil,
            updateMemory: options.updateMemoryState
        )
        if let handler = options.recordLogHandler {
            return .init(
                collections: items.map(handler),
                rescheduleItem: manualItem == nil ? nil : handler(manualItem)
            )
        } else {
            return .init(collections: items, rescheduleItem: manualItem)
        }
    }
}


// Upstream: Sources/FSRS/Algorithm/FSRSAlgorithm.swift
//
//  FSRSAlgorithm.swift
//
//  Created by nkq on 10/14/24.
//

import Foundation
/**
 * @see https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm#fsrs-45
 *
 * Immutable after `init`. All stored state is `let`; per-call randomness (the
 * fuzz seed) is threaded through method parameters rather than held as
 * instance state. This lets a single instance be shared across tasks/actors
 * without data races — see `FSRSAlgorithm: @unchecked Sendable` below.
 */
public class FSRSAlgorithm: @unchecked Sendable {
    /// Algorithm version inferred from the length of the active `w` vector.
    /// Drives version-dispatched formulas (decay, factor, S_MIN, init difficulty
    /// clamp location, short-term stability shape).
    public var version: FSRSAlgorithmVersion {
        FSRSAlgorithmVersion.detect(parameters.w)
    }

    /// Lower bound for stability. v5 = 0.01, v6 = 0.001 (matches upstream).
    var sMin: Double {
        switch version {
        case .v5: return FSRSDefaults.S_MIN
        case .v6: return FSRSDefaults.S_MIN_V6
        }
    }

    /**
     * @default DECAY = -0.5 for v5 ; -w[20] for v6
     */
    var decay: Double {
        switch version {
        case .v5: return -0.5
        case .v6: return -parameters.w[20]
        }
    }
    /**
     * FACTOR = Math.pow(0.9, 1 / DECAY) - 1
     *
     * $$\text{FACTOR} = \frac{19}{81}$$ for v5 (decay = -0.5); derived from
     * `w[20]` for v6.
     */
    var factor: Double {
        switch version {
        case .v5: return 19.0 / 81.0
        case .v6: return (exp(log(0.9) / decay) - 1.0).toFixedNumber(8)
        }
    }

    let defaults = FSRSDefaults()

    public let parameters: FSRSParameters

    /// Read-only accessor preserved for test ergonomics. Parameters are now
    /// immutable — to change them, construct a new `FSRS` instance.
    public var params: FSRSParameters { parameters }

    let intervalModifier: Double

    init(parameters: FSRSParameters) {
        // Migrate / clamp the input once. Subsequent reads of `self.parameters`
        // see the canonical, post-`generatorParameters` form.
        let migrated = FSRSDefaults().generatorParameters(props: parameters)
        self.parameters = migrated
        // Compute intervalModifier from the migrated parameters. We need the
        // version-dependent `decay` / `factor` here, which read `parameters`
        // via the computed properties — hence the temporary instance below.
        self.intervalModifier = Self.computeIntervalModifier(parameters: migrated)
    }

    private static func computeIntervalModifier(parameters: FSRSParameters) -> Double {
        let r = parameters.requestRetention
        guard r.isFinite, r > 0, r <= 1 else {
            // Preserve the prior behavior: invalid retention falls through to
            // the default identity modifier and is logged.
            if !r.isFinite {
                return 1
            }
            print("Requested retention rate should be in the range (0,1]")
            return 1
        }
        // Mirror `decay` / `factor` getter logic without an instance.
        let decay: Double
        let factor: Double
        if FSRSAlgorithmVersion.detect(parameters.w) == .v6 {
            decay = -parameters.w[20]
            factor = (exp(log(0.9) / decay) - 1.0).toFixedNumber(8)
        } else {
            decay = -0.5
            factor = 19.0 / 81.0
        }
        let result = (pow(r, 1 / decay) - 1.0) / factor
        return result.toFixedNumber(8)
    }

    /**
     * The formula used is :
     * $$ S_0(G) = w_{G-1}$$
     * $$S_0 = \max \lbrace S_0,0.1\rbrace $$

     * @param g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return Stability (interval when R=90%)
     */
    func initStability(g: Rating) -> Double {
        max(parameters.w[g.rawValue - 1], 0.1)
    }

    /**
     * The formula used is :
     * $$D_0(G) = w_4 - e^{(G-1) \cdot w_5} + 1 $$
     * $$D_0 = \min \lbrace \max \lbrace D_0(G),1 \rbrace,10 \rbrace$$
     * where the $$D_0(1)=w_4$$ when the first rating is good.
     *
     * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return {number} Difficulty $$D \in [1,10]$$
     */
    /// Initial difficulty, clamped to `[1, 10]`. Used as the canonical entry
    /// point — both v5 and v6 callers see clamped values here.
    func initDifficulty(_ grade: Rating) -> Double {
        constrainDifficulty(
            r: parameters.w[4] - exp((Double(grade.rawValue) - 1) * parameters.w[5]) + 1
        )
    }

    /// Raw, unclamped initial difficulty as defined by FSRS-6's
    /// `init_difficulty`. Used by v6's `nextDifficulty` for mean reversion,
    /// where the unclamped Easy-init value matters.
    func initDifficultyRaw(_ grade: Rating) -> Double {
        (parameters.w[4] - exp(Double(grade.rawValue - 1) * parameters.w[5]) + 1).toFixedNumber(8)
    }

    func constrainDifficulty(r: Double) -> Double {
        min(max(r.toFixedNumber(8), 1.0), 10.0)
    }

    /**
     * If fuzzing is disabled or ivl is less than 2.5, it returns the original interval.
     * - Parameters:
     *   - ivl: The interval to be fuzzed.
     *   - elapsedDays: t days since the last review.
     *   - seed: Per-call PRNG seed produced by the scheduler. Threading it as
     *     a parameter (rather than a stored property) keeps the algorithm
     *     instance immutable across concurrent calls.
     */
    func applyFuzz(ivl: Double, elapsedDays: Double, seed: String?) -> Int {
        guard parameters.enableFuzz && ivl >= 2.5 else { return Int(round(ivl)) }
        let genetaor = alea(seed: seed)
        let fuzzFactor = genetaor.next()
        let ivls = FSRSHelper.getFuzzRange(
            interval: ivl,
            elapsedDays: elapsedDays,
            maximumInterval: parameters.maximumInterval
        )
        return Int(floor(fuzzFactor * (ivls.maxIvl - ivls.minIvl + 1) + ivls.minIvl))
    }

    /**
     * - Parameters:
     *   - s: Stability (interval when R=90%).
     *   - elapsedDays: t days since the last review.
     *   - seed: Per-call PRNG seed (forwarded to `applyFuzz`).
     */
    func nextInterval(s: Double, elapsedDays: Double, seed: String?) -> Int {
        let newInterval = min(max(1, round(s * intervalModifier)), parameters.maximumInterval)
        return applyFuzz(ivl: newInterval, elapsedDays: elapsedDays, seed: seed)
    }

    /**
     * @see https://github.com/open-spaced-repetition/fsrs4anki/issues/697
     */
    func linearDamping(deltaD: Double, oldD: Double) -> Double {
        (deltaD * (10 - oldD) / 9).toFixedNumber(8)
    }

    /**
     * The formula used is :
     * $$\text{delta}_d = -w_6 \cdot (g - 3)$$
     * $$\text{next}_d = D + \text{linear damping}(\text{delta}_d , D)$$
     * $$D^\prime(D,R) = w_7 \cdot D_0(4) +(1 - w_7) \cdot \text{next}_d$$
     * @param {number} d Difficulty $$D \in [1,10]$$
     * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return {number} $$\text{next}_D$$
     */
    func nextDifficulty(d: Double, g: Rating) -> Double {
        let deltaD = -(parameters.w[6] * Double(g.rawValue - 3))
        let nextD = d + linearDamping(deltaD: deltaD, oldD: d)
        // v5 mean-reverts toward the *clamped* easy-init value; v6 mean-reverts
        // toward the *raw* easy-init value (this is part of v6's clamp-at-caller
        // refactor and changes outputs even when w is otherwise comparable).
        let initEasy: Double
        switch version {
        case .v5: initEasy = initDifficulty(.easy)
        case .v6: initEasy = initDifficultyRaw(.easy)
        }
        return constrainDifficulty(r: meanReversion(initValue: initEasy, current: nextD))
    }

    /**
     * The formula used is :
     * $$w_7 \cdot \text{init} +(1 - w_7) \cdot \text{current}$$
     * @param {number} init $$w_2 : D_0(3) = w_2 + (R-2) \cdot w_3= w_2$$
     * @param {number} current $$D - w_6 \cdot (R - 2)$$
     * @return {number} difficulty
     */
    func meanReversion(initValue: Double, current: Double) -> Double {
        (parameters.w[7] * initValue + (1 - parameters.w[7]) * current).toFixedNumber(8)
    }

    func nextRecallStability(d: Double, s: Double, r: Double, g: Rating) -> Double {
        let hardPenalty = g == .hard ? parameters.w[15] : 1
        let easyBound = g == .easy ? parameters.w[16] : 1
        return FSRSHelper.clamp(
            s * (
                1 + exp(parameters.w[8]) * (11 - d) * pow(s, -(parameters.w[9])) *
                (exp((1 - r) * parameters.w[10]) - 1) * hardPenalty * easyBound
            ),
            sMin,
            36500
        )
        .toFixedNumber(8)
    }

    /**
     * The formula used is :
     * $$S^\prime_f(D,S,R) = w_{11}\cdot D^{-w_{12}}\cdot ((S+1)^{w_{13}}-1) \cdot e^{w_{14}\cdot(1-R)}$$
     * enable_short_term = true : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, \frac{S}{e^{w_{17} \cdot w_{18}}} \rbrace$$
     * enable_short_term = false : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, S \rbrace$$
     * @param {number} d Difficulty D \in [1,10]
     * @param {number} s Stability (interval when R=90%)
     * @param {number} r Retrievability (probability of recall)
     * @return {number} S^\prime_f new stability after forgetting
     */
    func nextForgetStability(d: Double, s: Double, r: Double) -> Double {
        let p1 = pow(d, -(parameters.w[12]))
        let p2 = pow(s + 1, parameters.w[13]) - 1
        let p3 = exp((1 - r) * parameters.w[14])
        return FSRSHelper.clamp(
            parameters.w[11] * p1 * p2 * p3,
            sMin,
            36500
        ).toFixedNumber(8)
    }

    /**
     * The formula used is :
     * $$S^\prime_s(S,G) = S \cdot e^{w_{17} \cdot (G-3+w_{18})}$$
     * @param {number} s Stability (interval when R=90%)
     * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
     */
    func nextShortTermStability(s: Double, g: Rating) -> Double {
        let part = Double(g.rawValue) - 3 + parameters.w[18]
        switch version {
        case .v5:
            return FSRSHelper.clamp(
                s * exp(parameters.w[17] * part),
                sMin,
                36500
            ).toFixedNumber(8)
        case .v6:
            // v6 introduces an extra `s^-w[19]` factor and a Hard/Easy floor:
            // when sinc < 1 for grade ≥ Hard, snap it to 1 so non-Again grades
            // never *shrink* stability under short-term scheduling.
            let sinc = pow(s, -parameters.w[19]) * exp(parameters.w[17] * part)
            let masked = g.rawValue >= Rating.hard.rawValue ? max(sinc, 1.0) : sinc
            return FSRSHelper.clamp(
                s * masked,
                sMin,
                36500
            ).toFixedNumber(8)
        }
    }

    /**
     * The formula used is :
     * $$R(t,S) = (1 + \text{FACTOR} \times \frac{t}{9 \cdot S})^{\text{DECAY}}$$
     * @param {number} elapsed_days t days since the last review
     * @param {number} stability Stability (interval when R=90%)
     * @return {number} r Retrievability (probability of recall)
     */
    func forgettingCurve(elapsedDays: Double, stability: Double) -> Double {
        pow(1 + ((factor * elapsedDays) / stability), decay).toFixedNumber(8)
    }

    /**
      * Calculates the next state of memory based on the current state, time elapsed, and grade.
      *
      * @param memory_state - The current state of memory, which can be null.
      * @param t - The time elapsed since the last review.
      * @param {Rating} g Grade (Rating[0.Manual,1.Again,2.Hard,3.Good,4.Easy])
      * @returns The next state of memory with updated difficulty and stability.
      */
    func nextState(memoryState: FSRSState?, t: Double, g: Rating) throws -> FSRSState {
        let difficulty = memoryState?.difficulty ?? 0.0
        let stability = memoryState?.stability ?? 0.0
        if t < 0 {
            throw FSRSError.init(.invalidDeltaT)
        }
        if difficulty == 0 && stability == 0 {
            return FSRSState(stability: initStability(g: g), difficulty: initDifficulty(g))
        }
        if g == .manual {
            return FSRSState(stability: stability, difficulty: difficulty)
        }
        if difficulty < 1 || stability < sMin {
            throw FSRSError(.invalidParam)
        }
        let r = forgettingCurve(elapsedDays: t, stability: stability)
        let sAfterSuccess = nextRecallStability(d: difficulty, s: stability, r: r, g: g)
        let sAfterFail = nextForgetStability(d: difficulty, s: stability, r: r)
        let sAfterShortTerm = nextShortTermStability(s: stability, g: g)
        var newS = sAfterSuccess

        if g == .again {
            var w17 = 0.0
            var w18 = 0.0
            if params.enableShortTerm {
                w17 = params.w[17]
                w18 = params.w[18]
            }
            let nextSMin = stability / exp(w17 * w18)
            newS = FSRSHelper.clamp(nextSMin, sMin, sAfterFail)
        }

        if t == 0 && params.enableShortTerm {
            newS = sAfterShortTerm
        }

        let newD = nextDifficulty(d: difficulty, g: g)
        return FSRSState(stability: newS, difficulty: newD)
    }
}


// Upstream: Sources/FSRS/Helper/FSRSAlea.swift
//
//  FSRSAlea.swift
//
//  Created by nkq on 10/13/24.
//

import Foundation

class FSRSAlea {
    struct State: Equatable {
        var c: Int
        var s0: Double
        var s1: Double
        var s2: Double
    }

    private var c: Int
    private var s0: Double
    private var s1: Double
    private var s2: Double

    init(seed: Any? = nil) {
        var mash = MashWrapper()
        c = 1
        s0 = mash.do(" ")
        s1 = mash.do(" ")
        s2 = mash.do(" ")

        let seedValue: String = String(
            describing: seed ?? Date().timeIntervalSince1970
        )
        s0 -= mash.do(seedValue)
        if s0 < 0 { s0 += 1 }
        s1 -= mash.do(seedValue)
        if s1 < 0 { s1 += 1 }
        s2 -= mash.do(seedValue)
        if s2 < 0 { s2 += 1 }
    }

    func next() -> Double {
        let t = 2_091_639 * s0 + Double(c) * 2.3283064365386963e-10  // 2^-32
        s0 = s1
        s1 = s2
        c = Int(floor(t))
        s2 = t - floor(t)
        return s2
    }

    var state: State {
        get {
            State(c: c, s0: s0, s1: s1, s2: s2)
        }
        set {
            c = newValue.c
            s0 = newValue.s0
            s1 = newValue.s1
            s2 = newValue.s2
        }
    }
}

// Pure Swift implementation of the Alea Mash function (JS-free)
struct MashWrapper {
    // Internal 53-bit floating state mirroring JS number behavior
    private var n: Double = 0xEFC8_249D as Double  // 0xefc8249d

    // Convert a Double to JS ToUint32 result as Double (0..2^32-1)
    @inline(__always)
    private func toUint32(_ x: Double) -> Double {
        if !x.isFinite { return 0 }
        var r = fmod(x, 4294967296.0)  // 2^32
        if r < 0 { r += 4294967296.0 }
        return floor(r)
    }

    // Match JS String.charCodeAt over UTF-16 code units
    private func utf16Codes(_ s: String) -> [UInt16] {
        Array(s.utf16)
    }

    // Returns a double in [0,1) like the JS mash
    mutating func `do`(_ data: String) -> Double {
        // Coerce to String like JS does
        let str = String(data)
        for code in utf16Codes(str) {
            n += Double(code)
            var h = 0.02519603282416938 * n
            n = toUint32(h)
            h -= n
            h *= n
            n = toUint32(h)
            h -= n
            n += h * 4294967296.0  // 2^32
        }
        return toUint32(n) * 2.3283064365386963e-10  // 2^-32
    }
}

protocol PRNG {
    func next() -> Double
    func int32() -> Int32
    func double() -> Double
    func state() -> FSRSAlea.State
    func importState(_ state: FSRSAlea.State)
}

struct RandomNumberGeneratorWrapper: PRNG {
    private let alea: FSRSAlea

    init(seed: Any? = nil) {
        alea = FSRSAlea(seed: seed)
    }

    func next() -> Double {
        alea.next()
    }

    func int32() -> Int32 {
        Int32(truncatingIfNeeded: Int(alea.next() * Double(0x1_0000_0000)))
    }

    func double() -> Double {
        next() + Double(UInt(next() * 0x200000)) * 1.1102230246251565e-16  // 2^-53
    }

    func state() -> FSRSAlea.State {
        alea.state
    }

    func importState(_ state: FSRSAlea.State) {
        alea.state = state
    }
}

func alea(seed: Any? = nil) -> RandomNumberGeneratorWrapper {
    RandomNumberGeneratorWrapper(seed: seed)
}


// Upstream: Sources/FSRS/Helper/FSRSHelper.swift
//
//  FSRSHelper.swift
//
//  Created by nkq on 10/14/24.
//

import Foundation

class FSRSHelper {
    struct FuzzRange: Sendable {
        let start: Double
        let end: Double
        let factor: Double
    }

    static let fuzzRanges = [
        FuzzRange(start: 2.5, end: 7.0, factor: 0.15),
        .init(start: 7.0, end: 20.0, factor: 0.1),
        .init(start: 20, end: .infinity, factor: 0.05)
    ]

    static func getFuzzRange(
        interval: Double,
        elapsedDays: Double,
        maximumInterval: Double
    ) -> (minIvl: Double, maxIvl: Double) {
        var delta = 1.0
        for range in fuzzRanges {
            delta += range.factor * max(min(interval, range.end) - range.start, 0.0)
        }
        let newInterval = min(interval, maximumInterval)
        var minIvl = max(2, round(newInterval - delta))
        let maxIvl = min(round(newInterval + delta), maximumInterval)
        if newInterval > elapsedDays {
            minIvl = max(minIvl, elapsedDays + 1)
        }
        minIvl = min(minIvl, maxIvl)
        return (minIvl, maxIvl)
    }

    static func clamp(_ value: Double, _ minV: Double, _ maxV: Double) -> Double {
        min(max(value, minV), maxV)
    }
}

public struct FSRSError: Error, Equatable, Sendable {
    enum Reason: String, Error, Sendable {
        case invalidInterval
        case invalidRating
        case invalidRetention
        case invalidParam
        case invalidDeltaT
    }
    var errorReason: Reason
    var message: String?

    init(_ errorReason: Reason, _ message: String? = nil) {
        self.message = message
        self.errorReason = errorReason
    }
}

extension Date {

    enum TimeUnit: String, Codable, Sendable {
        case days
        case minutes
    }

    /**
     * 计算日期和时间的偏移，并返回一个新的日期对象。
     * @param now 当前日期和时间
     * @param t 时间偏移量，当 isDay 为 true 时表示天数，为 false 时表示分钟
     * @param unit （可选）是否按天数单位进行偏移，默认为 minutes，表示按分钟单位计算偏移
     * @returns 偏移后的日期和时间对象
     */
    static func dateScheduler(now: Date, t: Double, unit: TimeUnit = .minutes) -> Date {
        Date(timeIntervalSince1970:
            unit == .days
             ? now.timeIntervalSince1970 + t * 24 * 60 * 60
             : now.timeIntervalSince1970 + t * 60
        )
    }

    static func dateDiff(now: Date, pre: Date?, unit: TimeUnit) -> Double {
        guard let pre = pre else { return 0.0 }
        let diff = now.timeIntervalSince1970 - pre.timeIntervalSince1970
        var r = 0.0
        switch unit {
        case .days:
            r = floor(diff / (24 * 60 * 60))
        case .minutes:
            r = floor(diff / 60)
        }
        return r
    }

    static func dateDiffInDays(from last: Date?, to cur: Date) -> Double {
        guard let last = last else { return 0.0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .autoupdatingCurrent
        let startOfLast = calendar.startOfDay(for: last)
        let startOfCur = calendar.startOfDay(for: cur)
        return floor((startOfCur.timeIntervalSince1970 - startOfLast.timeIntervalSince1970) / (24 * 60 * 60))
    }

    func toString(_ dateFormat: String) -> String? {
        let formatter = DateFormatter()
        formatter.dateFormat = dateFormat
        return formatter.string(from: self)
    }

    static func formatDate(date: Date) -> String {
        date.toString("yyyy-MM-dd HH:mm:ss") ?? ""
    }

    static func fromString(_ date: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let gmt = TimeZone(secondsFromGMT: 0) {
            formatter.timeZone = gmt
        }
        return formatter.date(from: date)
    }

    static let timeUnit = [60.0, 60, 24, 31, 12]
    static let timeUnitsFormat = ["second", "min", "hour", "day", "month", "year"]
    static func showDiffMessage(
        _ due: Date,
        _ lastReview: Date,
        _ detailed: Bool = false,
        _ unit: [String] = timeUnitsFormat
    ) -> String {
        var unit = unit
        if unit.count != timeUnitsFormat.count {
            unit = timeUnitsFormat
        }
        var diff = due.timeIntervalSince1970 - lastReview.timeIntervalSince1970
        var i = 0
        for (index, unit) in timeUnit.enumerated() {
            if diff < unit {
                i = index
                break
            } else {
                diff /= unit
            }
            i += 1
        }
        return "\(Int(floor(diff)))\(detailed ? (unit[i]) : "")"
    }
}

extension Double {
    func toFixed(_ places: Int) -> String {
        return String(format: "%.\(places)f", self)
    }

    func toFixedNumber(_ places: Int) -> Double {
        return Double(String(format: "%.\(places)f", self)) ?? 0
    }
}


// Upstream: Sources/FSRS/Helper/FSRSSteps.swift
//
//  FSRSSteps.swift
//
//  Step parsing and the BasicLearningStepsStrategy used by the v6 scheduler.
//  Mirrors ts-fsrs's `strategies/learning_steps.ts` and `models.ts` step types.
//

import Foundation

/// Per-grade outcome from a learning-steps strategy.
public struct LearningStepOutcome: Equatable {
    /// Schedule the card this many minutes from now (rounded). 0 means the
    /// strategy has no opinion — the scheduler should fall through to
    /// algorithm-driven intervals.
    public let scheduledMinutes: Int
    /// `VendorFSRSCard.learningSteps` value to set on the resulting card.
    public let nextStep: Int
}

/// Strategy signature: given parameters, the card's current state, and the
/// current step index, return per-grade outcomes. Grades not present in the
/// dictionary fall through to algorithm-driven scheduling (typical for
/// `.easy`, and for `.hard`/`.good` when no step entry applies). Throws
/// `FSRSError(.invalidParam)` when a step string is malformed (e.g. `"5x"`).
public typealias LearningStepsStrategy = (
    _ params: FSRSParameters,
    _ state: CardState,
    _ curStep: Int
) throws -> [Rating: LearningStepOutcome]

/// Convert a step unit string (`"1m"`, `"10m"`, `"1h"`, `"1d"`) to minutes.
/// Throws if the string is malformed.
public func convertStepUnitToMinutes(_ step: String) throws -> Int {
    guard let last = step.last else {
        throw FSRSError(.invalidParam, "Empty step unit")
    }
    let valuePart = String(step.dropLast())
    guard let value = Int(valuePart), value >= 0 else {
        throw FSRSError(.invalidParam, "Invalid step value: \(step)")
    }
    switch last {
    case "m": return value
    case "h": return value * 60
    case "d": return value * 1440
    default:
        throw FSRSError(.invalidParam, "Invalid step unit: \(step), expected m/h/d")
    }
}

/// Match JavaScript `Math.round` semantics: half values round away from zero
/// (e.g. 5.5 → 6, -1.5 → -2). Swift's default `.rounded()` uses banker's
/// rounding, which would diverge on exact halves.
@inline(__always)
private func jsRound(_ x: Double) -> Int {
    Int(x.rounded(.toNearestOrAwayFromZero))
}

/// Reference learning-steps strategy mirroring ts-fsrs's
/// `BasicLearningStepsStrategy`.
///
/// Behavior:
/// - State `.review` (Again was pressed on a Review card) returns only the
///   `.again` outcome with `scheduled_minutes = relearning_steps[curStep]`,
///   pushing the card into Relearning.
/// - Otherwise, `.again` resets to the first step, `.hard` repeats the
///   current step (with a derived interval), and `.good` advances to the
///   next step (if any). `.easy` is never set — it always graduates to
///   Review via algorithm-driven scheduling.
///
/// Throws `FSRSError(.invalidParam)` if any consulted step string is
/// malformed. This intentionally fails the review attempt rather than
/// silently graduating the card on a typo'd config.
public func basicLearningStepsStrategy(
    params: FSRSParameters,
    state: CardState,
    curStep: Int
) throws -> [Rating: LearningStepOutcome] {
    let steps: [String] = (state == .relearning || state == .review)
        ? params.relearningSteps
        : params.learningSteps
    let stepsLength = steps.count

    if stepsLength == 0 || curStep >= stepsLength { return [:] }

    var result: [Rating: LearningStepOutcome] = [:]

    if state == .review {
        let info = steps[max(0, curStep)]
        let mins = try convertStepUnitToMinutes(info)
        result[.again] = LearningStepOutcome(scheduledMinutes: mins, nextStep: 0)
        return result
    }

    let firstMins = try convertStepUnitToMinutes(steps[0])

    // Hard interval:
    //   1 step  → round(first * 1.5)
    //   N steps → round((first + second) / 2)
    let hardInterval: Int
    if stepsLength == 1 {
        hardInterval = jsRound(Double(firstMins) * 1.5)
    } else {
        let secondMins = try convertStepUnitToMinutes(steps[1])
        hardInterval = jsRound(Double(firstMins + secondMins) / 2.0)
    }

    result[.again] = LearningStepOutcome(scheduledMinutes: firstMins, nextStep: 0)
    result[.hard] = LearningStepOutcome(scheduledMinutes: hardInterval, nextStep: curStep)

    let nextIdx = curStep + 1
    if nextIdx < stepsLength {
        let nextMins = try convertStepUnitToMinutes(steps[nextIdx])
        result[.good] = LearningStepOutcome(scheduledMinutes: nextMins, nextStep: nextIdx)
    }

    return result
}


// Upstream: Sources/FSRS/Models/FSRSDefaults.swift
//
//  FSRSDefaults.swift
//
//  Created by nkq on 10/13/24.
//

import Foundation

/// Algorithm version, derived from the length of the `w` parameter vector.
///
/// - `.v5` — 19-element `w` (legacy default, frozen for parity with existing tests).
/// - `.v6` — 21-element `w` (FSRS-6.0). `w[19]` is the short-term last-stability
///   exponent; `w[20]` is the learnable decay (defaults to 0.1542).
public enum FSRSAlgorithmVersion: Equatable, Sendable {
    case v5
    case v6

    /// Infer version from a `w` vector. 19-length is v5; 21-length is v6.
    /// 17-length (legacy v4) is treated as v5 because the existing migration
    /// path pads to 19, not 21.
    public static func detect(_ w: [Double]) -> FSRSAlgorithmVersion {
        w.count == 21 ? .v6 : .v5
    }
}

public final class FSRSDefaults: Sendable {
    /// Lower bound for stability under FSRS-5 semantics.
    static let S_MIN = 0.01
    /// Lower bound for stability under FSRS-6 semantics (matches upstream ts-fsrs).
    static let S_MIN_V6 = 0.001
    static let INIT_S_MAX = 100.0

    /// Default decay for fresh v6 models (canonical value from ts-fsrs).
    static let FSRS6_DEFAULT_DECAY = 0.1542

    /// Default ceiling for `w[17]` and `w[18]` when relearning_steps is empty
    /// or has length ≤ 1. ts-fsrs derives a tighter ceiling from the relearning
    /// steps count when > 1 (see `clampParametersV6`).
    static let W17_W18_CEILING = 2.0

    static let CLAMP_PARAMETERS = [
        [S_MIN, INIT_S_MAX] /** initial stability (Again) */,
        [S_MIN, INIT_S_MAX] /** initial stability (Hard) */,
        [S_MIN, INIT_S_MAX] /** initial stability (Good) */,
        [S_MIN, INIT_S_MAX] /** initial stability (Easy) */,
        [1.0, 10.0] /** initial difficulty (Good) */,
        [0.001, 4.0] /** initial difficulty (multiplier) */,
        [0.001, 4.0] /** difficulty (multiplier) */,
        [0.001, 0.75] /** difficulty (multiplier) */,
        [0.0, 4.5] /** stability (exponent) */,
        [0.0, 0.8] /** stability (negative power) */,
        [0.001, 3.5] /** stability (exponent) */,
        [0.001, 5.0] /** fail stability (multiplier) */,
        [0.001, 0.25] /** fail stability (negative power) */,
        [0.001, 0.9] /** fail stability (power) */,
        [0.0, 4.0] /** fail stability (exponent) */,
        [0.0, 1.0] /** stability (multiplier for Hard) */,
        [1.0, 6.0] /** stability (multiplier for Easy) */,
        [0.0, 2.0] /** short-term stability (exponent) */,
        [0.0, 2.0] /** short-term stability (exponent) */,
    ]

    /// V6 clamp ranges. Mirrors ts-fsrs's CLAMP_PARAMETERS function: rows 17/18
    /// share a configurable ceiling; row 19 (short-term last-stability exponent)
    /// has a lower bound that depends on `enable_short_term`; row 20 is decay.
    static func clampParametersV6(
        w17W18Ceiling: Double = W17_W18_CEILING,
        enableShortTerm: Bool = true
    ) -> [[Double]] {
        let base = CLAMP_PARAMETERS
            .prefix(17)
            .map { $0 } + [
                [0.0, w17W18Ceiling] /** short-term stability (exponent) */,
                [0.0, w17W18Ceiling] /** short-term stability (exponent) */,
                [enableShortTerm ? 0.01 : 0.0, 0.8] /** short-term last-stability (exponent) */,
                [0.1, 0.8] /** decay */,
            ]
        return base
    }

    /// Compute the dynamic `w17_w18_ceiling` from the relearning step count.
    /// Mirrors ts-fsrs's clipParameters derivation exactly.
    ///
    /// `parameters` is the *raw* w vector — generatorParameters calls this
    /// before clamping. Pre-clamp the values feeding into `log(...)` so an
    /// out-of-range `w[11]` / `w[13]` / `w[14]` can't NaN-poison the ceiling
    /// (and through it the rest of the clamp table). Math is unchanged for
    /// any in-range input.
    static func computeW17W18Ceiling(parameters: [Double], numRelearningSteps: Int) -> Double {
        guard max(0, numRelearningSteps) > 1 else { return W17_W18_CEILING }
        let w11 = FSRSHelper.clamp(parameters[11], 0.001, 5.0)
        let w13 = FSRSHelper.clamp(parameters[13], 0.001, 0.9)
        let w14 = FSRSHelper.clamp(parameters[14], 0.0, 4.0)
        // PLS = w11 * D ^ -w12 * [(S + 1) ^ w13 - 1] * e ^ (w14 * (1 - R))
        // Given D = 1, R = 0.7, S = 1, this collapses to:
        //   PLS = w11 * (2 ^ w13 - 1) * e ^ (w14 * 0.3)
        // We require PLS * e ^ (n * w17 * w18) ≤ S = 1, so:
        //   n * w17 * w18 ≤ -[ln(w11) + ln(2 ^ w13 - 1) + w14 * 0.3]
        let value = -(
            log(w11) +
            log(pow(2.0, w13) - 1.0) +
            w14 * 0.3
        ) / Double(numRelearningSteps)
        return FSRSHelper.clamp(value.toFixedNumber(8), 0.01, 2.0)
    }

    let defaultRequestRetention = 0.9
    let defaultMaximumInterval = 36500.0
    let defaultW = [
        0.40255, 1.18385, 3.173, 15.69105, 7.1949,
        0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
        1.01925, 1.9395, 0.11, 0.29605, 2.2698,
        0.2315, 2.9898, 0.51655, 0.6621
    ]
    /// Canonical FSRS-6.0 default `w` (21 elements). Pass this to `FSRSParameters`
    /// to opt in to v6 semantics.
    public static let defaultWv6: [Double] = [
        0.212, 1.2931, 2.3065, 8.2956, 6.4133,
        0.8334, 3.0194, 0.001, 1.8722, 0.1666,
        0.796, 1.4835, 0.0614, 0.2629, 1.6483,
        0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
        FSRS6_DEFAULT_DECAY,
    ]
    let defaultEnableFuzz = false
    let defaultEnableShortTerm = true

    /// Default learning steps used by v6 schedulers (no effect under v5).
    public static let defaultLearningSteps: [String] = ["1m", "10m"]
    /// Default relearning steps used by v6 schedulers (no effect under v5).
    public static let defaultRelearningSteps: [String] = ["10m"]

    let FSRSVersion: String = "v5.1.0 using FSRS-5.0"

    func generatorParameters(props: FSRSParameters? = nil) -> FSRSParameters {
        var w = defaultW

        if let p = props {
            switch p.w.count {
            case 21:
                w = p.w
            case 19:
                w = p.w
            case 17:
                w = p.w
                w.append(0.0)
                w.append(0.0)
                w[4] = (w[5] * 2.0 + w[4]).toFixedNumber(8)
                w[5] = (log(w[5] * 3.0 + 1.0) / 3.0).toFixedNumber(8)
                w[6] = (w[6] + 0.5).toFixedNumber(8)
                print("[FSRS V5]auto fill w to 19 length")
            default:
                break
            }
        }

        let enableShortTerm = props?.enableShortTerm ?? defaultEnableShortTerm
        let learningSteps = props?.learningSteps ?? Self.defaultLearningSteps
        let relearningSteps = props?.relearningSteps ?? Self.defaultRelearningSteps

        // Pick the right clamp table based on the (possibly migrated) w length.
        let clampTable: [[Double]]
        if w.count == 21 {
            let ceiling = Self.computeW17W18Ceiling(
                parameters: w,
                numRelearningSteps: relearningSteps.count
            )
            clampTable = Self.clampParametersV6(
                w17W18Ceiling: ceiling,
                enableShortTerm: enableShortTerm
            )
        } else {
            clampTable = Self.CLAMP_PARAMETERS
        }

        w = w.enumerated().map({
            FSRSHelper.clamp($0.element, clampTable[$0.offset][0], clampTable[$0.offset][1])
        })

        // 17→19 (legacy v4→v5) was already handled above. Note: we deliberately do
        // NOT auto-migrate 19→21. Callers who want v6 must pass a 21-length w
        // (e.g. FSRSDefaults.defaultWv6) — silent migration would change behavior.

        return FSRSParameters(
            requestRetention: props?.requestRetention ?? defaultRequestRetention,
            maximumInterval: props?.maximumInterval ?? defaultMaximumInterval,
            w: w,
            enableFuzz: props?.enableFuzz ?? defaultEnableFuzz,
            enableShortTerm: enableShortTerm,
            learningSteps: learningSteps,
            relearningSteps: relearningSteps
        )
    }


    /**
     * Create an empty card
     * @param now Current time
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```
     * const card: VendorFSRSCard = createEmptyCard(new Date());
     * ```
     * @example
     * ```
     * interface CardUnChecked
     *   extends Omit<VendorFSRSCard, "due" | "last_review" | "state"> {
     *   cid: string;
     *   due: Date | number;
     *   last_review: Date | null | number;
     *   state: StateType;
     * }
     *
     * function cardAfterHandler(card: VendorFSRSCard) {
     *      return {
     *       ...card,
     *       cid: "test001",
     *       state: State[card.state],
     *       last_review: card.last_review ?? null,
     *     } as CardUnChecked;
     * }
     *
     * const card: CardUnChecked = createEmptyCard(new Date(), cardAfterHandler);
     * ```
     */
    func createEmptyCard(now: Date = Date(), afterHandler: ((VendorFSRSCard) -> VendorFSRSCard)? = nil) -> VendorFSRSCard {
        let card = VendorFSRSCard(due: now)
        return afterHandler?(card) ?? card
    }
}


// Upstream: Sources/FSRS/Models/FSRSModels.swift
//
//  FSRSModels.swift
//
//  Created by nkq on 10/13/24.
//

import Foundation

public enum CardState: Int, Codable, Sendable {
      case new = 0
      case learning = 1
      case review = 2
      case relearning = 3

    public var stringValue: String {
        switch self {
        case .new: return "new"
        case .learning: return "learning"
        case .review: return "review"
        case .relearning: return "relearning"
        }
    }
}

public enum Rating: Int, Codable, Equatable, CaseIterable, Sendable {
    case manual = 0, again = 1, hard, good, easy

    public var stringValue: String {
        switch self {
        case .manual: return "manual"
        case .again: return "again"
        case .hard: return "hard"
        case .good: return "good"
        case .easy: return "easy"
        }
    }
}

public struct ReviewLog: Equatable, Codable, Hashable, Sendable {
    public var rating: Rating          // Rating of the review (Again, Hard, Good, Easy)
    public var state: CardState?       // State of the review (New, Learning, Review, Relearning)
    public var due: Date?              // Date of the last scheduling
    public var stability: Double?      // Memory stability during the review
    public var difficulty: Double?     // Difficulty of the card during the review
    public var elapsedDays: Double     // Number of days elapsed since the last review
    public var lastElapsedDays: Double // Number of days between the last two reviews
    public var scheduledDays: Double   // Number of days until the next review
    /// 0-based index into `params.learningSteps` / `relearningSteps`. Only
    /// meaningful when the card's `state` is `.learning` or `.relearning` —
    /// in `.new`/`.review` the value is just 0 because no step applies.
    /// Always 0 under v5 (v5's scheduler doesn't expose configurable steps).
    public var learningSteps: Int
    public var review: Date            // Date of the review

    public init(
        rating: Rating,
        state: CardState? = nil,
        due: Date? = nil,
        stability: Double? = nil,
        difficulty: Double? = nil,
        elapsedDays: Double = 0,
        lastElapsedDays: Double = 0,
        scheduledDays: Double = 0,
        learningSteps: Int = 0,
        review: Date
    ) {
        self.rating = rating
        self.state = state
        self.due = due
        self.stability = stability
        self.difficulty = difficulty
        self.elapsedDays = elapsedDays
        self.lastElapsedDays = lastElapsedDays
        self.scheduledDays = scheduledDays
        self.learningSteps = learningSteps
        self.review = review
    }

    enum CodingKeys: String, CodingKey {
        case rating, state, due, stability, difficulty
        case elapsedDays, lastElapsedDays, scheduledDays, learningSteps, review
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.rating = try c.decode(Rating.self, forKey: .rating)
        self.state = try c.decodeIfPresent(CardState.self, forKey: .state)
        self.due = try c.decodeIfPresent(Date.self, forKey: .due)
        self.stability = try c.decodeIfPresent(Double.self, forKey: .stability)
        self.difficulty = try c.decodeIfPresent(Double.self, forKey: .difficulty)
        self.elapsedDays = try c.decodeIfPresent(Double.self, forKey: .elapsedDays) ?? 0
        self.lastElapsedDays = try c.decodeIfPresent(Double.self, forKey: .lastElapsedDays) ?? 0
        self.scheduledDays = try c.decodeIfPresent(Double.self, forKey: .scheduledDays) ?? 0
        self.learningSteps = try c.decodeIfPresent(Int.self, forKey: .learningSteps) ?? 0
        self.review = try c.decode(Date.self, forKey: .review)
    }

    public var newLog: ReviewLog {
        ReviewLog(
            rating: rating,
            state: state,
            due: due,
            stability: stability,
            difficulty: difficulty,
            elapsedDays: elapsedDays,
            lastElapsedDays: lastElapsedDays,
            scheduledDays: scheduledDays,
            learningSteps: learningSteps,
            review: review
        )
    }
}

public struct VendorFSRSCard: Equatable, Codable, Hashable, Sendable {
    public var due: Date             // Date when the card is next due for review
    public var stability: Double     // A measure of how well the information is retained
    public var difficulty: Double    // Reflects the inherent difficulty of the card content
    public var elapsedDays: Double   // Days since the card was last reviewed
    public var scheduledDays: Double // The interval at which the card is next scheduled
    /// 0-based index into `params.learningSteps` / `relearningSteps`. Only
    /// meaningful when `state` is `.learning` or `.relearning` — in
    /// `.new`/`.review` the value is just 0 because no step applies. Always
    /// 0 under v5 (v5's scheduler doesn't expose configurable steps).
    public var learningSteps: Int
    public var reps: Int             // Total number of times the card has been reviewed
    public var lapses: Int           // Times the card was forgotten or remembered incorrectly
    public var state: CardState      // The current state of the card (New, Learning, Review, Relearning)
    public var lastReview: Date?     // The most recent review date, if applicable

    public init(
        due: Date = Date(),
        stability: Double = 0,
        difficulty: Double = 0,
        elapsedDays: Double = 0,
        scheduledDays: Double = 0,
        learningSteps: Int = 0,
        reps: Int = 0,
        lapses: Int = 0,
        state: CardState = .new,
        lastReview: Date? = nil
    ) {
        self.due = due
        self.stability = stability
        self.difficulty = difficulty
        self.elapsedDays = elapsedDays
        self.scheduledDays = scheduledDays
        self.learningSteps = learningSteps
        self.reps = reps
        self.lapses = lapses
        self.state = state
        self.lastReview = lastReview
    }

    enum CodingKeys: String, CodingKey {
        case due, stability, difficulty, elapsedDays, scheduledDays
        case learningSteps, reps, lapses, state, lastReview
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.due = try c.decode(Date.self, forKey: .due)
        self.stability = try c.decodeIfPresent(Double.self, forKey: .stability) ?? 0
        self.difficulty = try c.decodeIfPresent(Double.self, forKey: .difficulty) ?? 0
        self.elapsedDays = try c.decodeIfPresent(Double.self, forKey: .elapsedDays) ?? 0
        self.scheduledDays = try c.decodeIfPresent(Double.self, forKey: .scheduledDays) ?? 0
        self.learningSteps = try c.decodeIfPresent(Int.self, forKey: .learningSteps) ?? 0
        self.reps = try c.decodeIfPresent(Int.self, forKey: .reps) ?? 0
        self.lapses = try c.decodeIfPresent(Int.self, forKey: .lapses) ?? 0
        self.state = try c.decodeIfPresent(CardState.self, forKey: .state) ?? .new
        self.lastReview = try c.decodeIfPresent(Date.self, forKey: .lastReview)
    }

    public var newCard: VendorFSRSCard {
        VendorFSRSCard(
            due: due,
            stability: stability,
            difficulty: difficulty,
            elapsedDays: elapsedDays,
            scheduledDays: scheduledDays,
            learningSteps: learningSteps,
            reps: reps,
            lapses: lapses,
            state: state,
            lastReview: lastReview
        )
    }

    func printLog() {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(self)
            print(data)
        } catch {
            print("Error serializing JSON: \(error)")
        }
    }
}

public struct RecordLogItem: Codable, Equatable, Hashable, Sendable {
    public var card: VendorFSRSCard
    public var log: ReviewLog

    public init(card: VendorFSRSCard, log: ReviewLog) {
        self.card = card
        self.log = log
    }
}

public typealias RecordLog = [Rating: RecordLogItem]

public struct FSRSParameters: Codable, Equatable, Sendable {
    public var requestRetention: Double
    public var maximumInterval: Double
    public var w: [Double]
    public var enableFuzz: Bool
    public var enableShortTerm: Bool
    /// Configurable learning steps applied by the v6 BasicScheduler when
    /// `enableShortTerm` is true. Each entry is a string like `"1m"`, `"10m"`,
    /// `"1h"`, or `"1d"`. Has no effect under v5 (the v5 scheduler uses
    /// hardcoded steps for backward compatibility).
    public var learningSteps: [String]
    /// Configurable relearning steps applied by the v6 BasicScheduler when
    /// transitioning a Review card via `again` back into Relearning. Has no
    /// effect under v5.
    public var relearningSteps: [String]

    public init(
        requestRetention: Double? = nil,
        maximumInterval: Double? = nil,
        w: [Double]? = nil,
        enableFuzz: Bool? = nil,
        enableShortTerm: Bool? = nil,
        learningSteps: [String]? = nil,
        relearningSteps: [String]? = nil
    ) {
        let defaults = FSRSDefaults()
        self.requestRetention = requestRetention ?? defaults.defaultRequestRetention
        self.maximumInterval = maximumInterval ?? defaults.defaultMaximumInterval
        self.w = w ?? defaults.defaultW
        self.enableFuzz = enableFuzz ?? defaults.defaultEnableFuzz
        self.enableShortTerm = enableShortTerm ?? defaults.defaultEnableShortTerm
        self.learningSteps = learningSteps ?? FSRSDefaults.defaultLearningSteps
        self.relearningSteps = relearningSteps ?? FSRSDefaults.defaultRelearningSteps
    }

    enum CodingKeys: String, CodingKey {
        case requestRetention, maximumInterval, w, enableFuzz, enableShortTerm
        case learningSteps, relearningSteps
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = FSRSDefaults()
        self.requestRetention = try c.decodeIfPresent(Double.self, forKey: .requestRetention) ?? defaults.defaultRequestRetention
        self.maximumInterval = try c.decodeIfPresent(Double.self, forKey: .maximumInterval) ?? defaults.defaultMaximumInterval
        self.w = try c.decodeIfPresent([Double].self, forKey: .w) ?? defaults.defaultW
        self.enableFuzz = try c.decodeIfPresent(Bool.self, forKey: .enableFuzz) ?? defaults.defaultEnableFuzz
        self.enableShortTerm = try c.decodeIfPresent(Bool.self, forKey: .enableShortTerm) ?? defaults.defaultEnableShortTerm
        self.learningSteps = try c.decodeIfPresent([String].self, forKey: .learningSteps) ?? FSRSDefaults.defaultLearningSteps
        self.relearningSteps = try c.decodeIfPresent([String].self, forKey: .relearningSteps) ?? FSRSDefaults.defaultRelearningSteps
    }
}

public struct FSRSReview: Codable, Sendable {
    /**
     * 0-4: Manual, Again, Hard, Good, Easy
     * = revlog.rating
     */
    public var rating: Rating
    /**
     * The number of days that passed
     * = revlog.elapsed_days
     * = round(revlog[-1].review - revlog[-2].review)
     */
    public var deltaT: Double
}

public struct FSRSState: Codable, Sendable {
    public var stability: Double
    public var difficulty: Double
}


// Upstream: Sources/FSRS/Models/FSRSTypes.swift
//
//  FSRSTypes.swift
//
//  Created by nkq on 10/13/24.
//

import Foundation

public struct IPreview: Sendable {
    var recordLog: RecordLog

    init(recordLog: RecordLog) {
        self.recordLog = recordLog
    }

    public subscript(rating: Rating) -> RecordLogItem? {
        get {
            recordLog[rating]
        }
        set {
            recordLog[rating] = newValue
        }
    }
}

public protocol IScheduler {
    var preview: IPreview { get throws }
    func review(_ g: Rating) throws -> RecordLogItem
}

/**
 * Options for rescheduling.
 *
 * @template T - The type of the result returned by the `recordLogHandler` function.
 */
public struct RescheduleOptions: Sendable {
    /**
     * A function that handles recording the log.
     *
     * @param recordLog - The log to be recorded.
     * @returns The result of recording the log.
     */
    var recordLogHandler: (@Sendable (_ recordLog: RecordLogItem?) -> RecordLogItem?)?

    /**
     * A function that defines the order of reviews.
     *
     * @param a - The first FSRSHistory object.
     * @param b - The second FSRSHistory object.
     */
    var reviewsOrderBy: (@Sendable (_ a: ReviewLog, _ b: ReviewLog) -> Bool)?

    /**
     * Indicating whether to skip manual steps.
     */
    var skipManual: Bool = true

    /**
     * Indicating whether to update the FSRS memory state.
     */
    var updateMemoryState: Bool = false

    /**
     * The current date and time.
     */
    var now: Date = Date()

    /**
     * The input for the first card.
     */
    var firstCard: VendorFSRSCard?
}

public struct IReschedule: Equatable, Sendable {
    var collections: [RecordLogItem?]
    var rescheduleItem: RecordLogItem?
}


// Upstream: Sources/FSRS/Scheduler/AbstractScheduler.swift
//
//  AbstractSch.swift
//
//  Created by nkq on 10/13/24.
//

import Foundation

class AbstractScheduler: IScheduler {
    var preview: IPreview {
        get throws {
            .init(recordLog: [
                .again: try review(.again),
                .hard: try review(.hard),
                .good: try review(.good),
                .easy: try review(.easy)
            ])
        }
    }
    var last: VendorFSRSCard
    var current: VendorFSRSCard
    var reviewTime: Date
    var next: [Rating: RecordLogItem] = [:]
    var algorithm: FSRSAlgorithm
    /// Per-call PRNG seed. Owned by the scheduler (which is created fresh per
    /// review) so concurrent calls on a shared `FSRSAlgorithm` don't race.
    let seed: String

    init(
        card: VendorFSRSCard,
        reviewTime: Date,
        algorithm: FSRSAlgorithm
    ) {
        self.algorithm = algorithm
        self.last = card.newCard
        self.current = card.newCard
        self.reviewTime = reviewTime

        var interval = 0.0
        if current.state != .new && current.lastReview != nil {
            interval = Date.dateDiffInDays(from: current.lastReview, to: reviewTime)
        }
        self.current.lastReview = reviewTime
        self.current.elapsedDays = interval
        self.current.reps += 1
        self.seed = "\(reviewTime.timeIntervalSince1970)_\(current.reps)_\(current.difficulty * current.stability)"
    }

    func review(_ g: Rating) throws -> RecordLogItem {
        switch last.state {
        case .new:
            return try newState(grade: g)
        case .learning, .relearning:
            return try learningState(grade: g)
        case .review:
            return try reviewState(grade: g)
        }
    }

    func newState(grade: Rating) throws -> RecordLogItem {
        print("subclass must override")
        return .init(card: VendorFSRSCard(), log: ReviewLog(rating: .manual, state: .new, due: Date(), review: Date()))
    }
    func learningState(grade: Rating) throws -> RecordLogItem {
        print("subclass must override")
        return .init(card: VendorFSRSCard(), log: ReviewLog(rating: .manual, state: .new, due: Date(), review: Date()))
    }
    func reviewState(grade: Rating) throws -> RecordLogItem {
        print("subclass must override")
        return .init(card: VendorFSRSCard(), log: ReviewLog(rating: .manual, state: .new, due: Date(), review: Date()))
    }

    func buildLog(rating: Rating) -> ReviewLog {
        .init(rating: rating,
              state: current.state,
              due: last.lastReview == nil ? last.due : last.lastReview ?? Date(),
              stability: current.stability,
              difficulty: current.difficulty,
              elapsedDays: current.elapsedDays,
              lastElapsedDays: last.elapsedDays,
              scheduledDays: current.scheduledDays,
              learningSteps: current.learningSteps,
              review: reviewTime
        )
    }
}


// Upstream: Sources/FSRS/Scheduler/BasicScheduler.swift
//
//  BasicScheduler.swift
//
//  Created by nkq on 10/14/24.
//

import Foundation

class BasicScheduler: AbstractScheduler {
    override func newState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }
        var next = current.newCard
        next.difficulty = algorithm.initDifficulty(grade)
        next.stability = algorithm.initStability(g: grade)
        switch grade {
        case .again:
            next.scheduledDays = 0
            next.due = Date.dateScheduler(now: reviewTime, t: 1)
            next.state = .learning
        case .hard:
            next.scheduledDays = 0
            next.due = Date.dateScheduler(now: reviewTime, t: 5)
            next.state = .learning
        case .good:
            next.scheduledDays = 0
            next.due = Date.dateScheduler(now: reviewTime, t: 10)
            next.state = .learning
        case .easy:
            let easyInterval = algorithm.nextInterval(
                s: next.stability,
                elapsedDays: current.elapsedDays,
                seed: seed
            )
            next.scheduledDays = Double(easyInterval)
            next.due = Date.dateScheduler(now: reviewTime, t: Double(easyInterval), unit: .days)
            next.state = .review
        case .manual: break
        }
        return .init(card: next, log: buildLog(rating: grade))
    }

    override func learningState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }
        var next = current.newCard
        let interval = current.elapsedDays
        next.difficulty = algorithm.nextDifficulty(d: last.difficulty, g: grade)
        next.stability = algorithm.nextShortTermStability(s: last.stability, g: grade)
        switch grade {
        case .again:
            next.scheduledDays = 0
            next.due = Date.dateScheduler(now: reviewTime, t: 5)
            next.state = last.state
        case .hard:
            next.scheduledDays = 0
            next.due = Date.dateScheduler(now: reviewTime, t: 10)
            next.state = last.state
        case .good:
            let goodInterval = algorithm.nextInterval(
                s: next.stability,
                elapsedDays: interval,
                seed: seed
            )
            next.scheduledDays = Double(goodInterval)
            next.due = Date.dateScheduler(now: reviewTime, t: Double(goodInterval), unit: .days)
            next.state = .review
        case .easy:
            let goodStability = algorithm.nextShortTermStability(
                s: last.stability,
                g: .good
            )
            let goodInterval = algorithm.nextInterval(
                s: goodStability,
                elapsedDays: interval,
                seed: seed
            )
            let easyInterval = max(algorithm.nextInterval(
                s: next.stability,
                elapsedDays: interval,
                seed: seed
            ), goodInterval + 1)
            next.scheduledDays = Double(easyInterval)
            next.due = Date.dateScheduler(now: reviewTime, t: Double(easyInterval), unit: .days)
            next.state = .review
        case .manual: break
        }
        return .init(card: next, log: buildLog(rating: grade))
    }

    override func reviewState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }
        let interval = current.elapsedDays
        let retrievability = algorithm.forgettingCurve(
            elapsedDays: interval, stability: last.stability
        )
        let nextArray = Array(repeating: current.newCard, count: 4)
        var nextAgain = nextArray[0]
        var nextHard = nextArray[1]
        var nextGood = nextArray[2]
        var nextEasy = nextArray[3]

        nextDs(
            &nextAgain, &nextHard, &nextGood, &nextEasy,
            difficulty: last.difficulty,
            stability: last.stability,
            retrievability: retrievability
        )

        nextInterval(&nextAgain, &nextHard, &nextGood, &nextEasy, interval: interval)
        nextState(&nextAgain, &nextHard, &nextGood, &nextEasy)

        nextAgain.lapses += 1

        let itemAgain = RecordLogItem(
            card: nextAgain,
            log: buildLog(rating: .again)
        )
        let itemHard = RecordLogItem(
            card: nextHard,
            log: buildLog(rating: .hard)
        )
        let itemGood = RecordLogItem(
            card: nextGood,
            log: buildLog(rating: .good)
        )
        let itemEasy = RecordLogItem(
            card: nextEasy,
            log: buildLog(rating: .easy)
        )

        next[.again] = itemAgain
        next[.hard] = itemHard
        next[.good] = itemGood
        next[.easy] = itemEasy

        return next[grade]!
    }

    private func nextDs(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard,
        difficulty: Double,
        stability: Double,
        retrievability: Double
    ) {
        nextAgain.difficulty = algorithm.nextDifficulty(d: difficulty, g: .again)
        let nextSMin = stability / exp(algorithm.parameters.w[17] * algorithm.parameters.w[18])
        let sAfterAll = algorithm.nextForgetStability(d: difficulty, s: stability, r: retrievability)
        nextAgain.stability = FSRSHelper.clamp(nextSMin.toFixedNumber(8), algorithm.sMin, sAfterAll)

        nextHard.difficulty = algorithm.nextDifficulty(d: difficulty, g: .hard)
        nextHard.stability = algorithm.nextRecallStability(
            d: difficulty, s: stability, r: retrievability, g: .hard
        )

        nextGood.difficulty = algorithm.nextDifficulty(d: difficulty, g: .good)
        nextGood.stability = algorithm.nextRecallStability(
            d: difficulty, s: stability, r: retrievability, g: .good
        )

        nextEasy.difficulty = algorithm.nextDifficulty(d: difficulty, g: .easy)
        nextEasy.stability = algorithm.nextRecallStability(
            d: difficulty, s: stability, r: retrievability, g: .easy
        )
    }

    private func nextInterval(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard,
        interval: Double
    ) {
        var hardInterval = algorithm.nextInterval(
            s: nextHard.stability, elapsedDays: interval, seed: seed
        )
        var goodInterval = algorithm.nextInterval(
            s: nextGood.stability, elapsedDays: interval, seed: seed
        )
        hardInterval = min(hardInterval, goodInterval)
        goodInterval = max(goodInterval, hardInterval + 1)
        let easyInteval = max(
            algorithm.nextInterval(s: nextEasy.stability, elapsedDays: interval, seed: seed),
            goodInterval + 1
        )
        nextAgain.scheduledDays = 0
        nextAgain.due = Date.dateScheduler(now: reviewTime, t: 5)

        nextHard.scheduledDays = Double(hardInterval)
        nextHard.due = Date.dateScheduler(now: reviewTime, t: Double(hardInterval), unit: .days)

        nextGood.scheduledDays = Double(goodInterval)
        nextGood.due = Date.dateScheduler(now: reviewTime, t: Double(goodInterval), unit: .days)

        nextEasy.scheduledDays = Double(easyInteval)
        nextEasy.due = Date.dateScheduler(now: reviewTime, t: Double(easyInteval), unit: .days)
    }

    private func nextState(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard
    ) {
        nextAgain.state = .relearning
        nextHard.state = .review
        nextGood.state = .review
        nextEasy.state = .review
    }
}


// Upstream: Sources/FSRS/Scheduler/BasicSchedulerV6.swift
//
//  BasicSchedulerV6.swift
//
//  v6 BasicScheduler. Mirrors ts-fsrs's basic_scheduler.ts: delegates state
//  transitions to algorithm.nextState and applies configurable
//  learning/relearning steps via basicLearningStepsStrategy.
//

import Foundation

class BasicSchedulerV6: AbstractScheduler {

    private func getStepInfo(
        grade: Rating,
        fromState state: CardState,
        curStep: Int
    ) throws -> (scheduledMinutes: Int, nextStep: Int) {
        let strategy = try basicLearningStepsStrategy(
            params: algorithm.parameters,
            state: state,
            curStep: curStep
        )
        let outcome = strategy[grade]
        return (
            scheduledMinutes: max(0, outcome?.scheduledMinutes ?? 0),
            nextStep: max(0, outcome?.nextStep ?? 0)
        )
    }

    private func applyLearningSteps(
        nextCard: inout VendorFSRSCard,
        grade: Rating,
        toState: CardState
    ) throws {
        let info = try getStepInfo(
            grade: grade,
            fromState: current.state,
            curStep: current.learningSteps
        )
        let mins = info.scheduledMinutes
        let nextSteps = info.nextStep

        if mins > 0 && mins < 1440 /** 1 day */ {
            nextCard.learningSteps = nextSteps
            nextCard.scheduledDays = 0
            nextCard.state = toState
            nextCard.due = Date.dateScheduler(now: reviewTime, t: Double(mins), unit: .minutes)
        } else {
            nextCard.state = .review
            if mins >= 1440 {
                nextCard.learningSteps = nextSteps
                nextCard.due = Date.dateScheduler(now: reviewTime, t: Double(mins), unit: .minutes)
                nextCard.scheduledDays = Double(mins / 1440)
            } else {
                nextCard.learningSteps = 0
                let interval = algorithm.nextInterval(
                    s: nextCard.stability,
                    elapsedDays: current.elapsedDays,
                    seed: seed
                )
                nextCard.scheduledDays = Double(interval)
                nextCard.due = Date.dateScheduler(now: reviewTime, t: Double(interval), unit: .days)
            }
        }
    }

    /// Compute the next memory state via `algorithm.nextState`. v6's
    /// `nextState` handles the new-card init, manual-rating short-circuit,
    /// short-term path, again-clamp, and recall path internally — keeping
    /// the scheduler thin. Propagates `FSRSError(.invalidDeltaT)` /
    /// `.invalidParam` so callers see invalid clock skew or corrupted card
    /// state instead of silently scheduling against stale numbers.
    private func nextDs(t: Double, grade: Rating) throws -> VendorFSRSCard {
        var card = current.newCard
        let memoryState = FSRSState(stability: current.stability, difficulty: current.difficulty)
        let nextState = try algorithm.nextState(memoryState: memoryState, t: t, g: grade)
        card.difficulty = nextState.difficulty
        card.stability = nextState.stability
        return card
    }

    override func newState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }
        var card = try nextDs(t: current.elapsedDays, grade: grade)
        try applyLearningSteps(nextCard: &card, grade: grade, toState: .learning)
        let item = RecordLogItem(card: card, log: buildLog(rating: grade))
        next[grade] = item
        return item
    }

    override func learningState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }
        var card = try nextDs(t: current.elapsedDays, grade: grade)
        try applyLearningSteps(nextCard: &card, grade: grade, toState: last.state)
        let item = RecordLogItem(card: card, log: buildLog(rating: grade))
        next[grade] = item
        return item
    }

    override func reviewState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }
        let interval = current.elapsedDays

        var nextAgain = try nextDs(t: interval, grade: .again)
        var nextHard = try nextDs(t: interval, grade: .hard)
        var nextGood = try nextDs(t: interval, grade: .good)
        var nextEasy = try nextDs(t: interval, grade: .easy)

        nextIntervalReview(&nextHard, &nextGood, &nextEasy, interval: interval)
        nextStateReview(&nextHard, &nextGood, &nextEasy)
        try applyLearningSteps(nextCard: &nextAgain, grade: .again, toState: .relearning)
        nextAgain.lapses += 1

        next[.again] = RecordLogItem(card: nextAgain, log: buildLog(rating: .again))
        next[.hard] = RecordLogItem(card: nextHard, log: buildLog(rating: .hard))
        next[.good] = RecordLogItem(card: nextGood, log: buildLog(rating: .good))
        next[.easy] = RecordLogItem(card: nextEasy, log: buildLog(rating: .easy))

        return next[grade]!
    }

    private func nextIntervalReview(
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard,
        interval: Double
    ) {
        var hardInterval = algorithm.nextInterval(s: nextHard.stability, elapsedDays: interval, seed: seed)
        var goodInterval = algorithm.nextInterval(s: nextGood.stability, elapsedDays: interval, seed: seed)
        hardInterval = min(hardInterval, goodInterval)
        goodInterval = max(goodInterval, hardInterval + 1)
        let easyInterval = max(
            algorithm.nextInterval(s: nextEasy.stability, elapsedDays: interval, seed: seed),
            goodInterval + 1
        )

        nextHard.scheduledDays = Double(hardInterval)
        nextHard.due = Date.dateScheduler(now: reviewTime, t: Double(hardInterval), unit: .days)
        nextGood.scheduledDays = Double(goodInterval)
        nextGood.due = Date.dateScheduler(now: reviewTime, t: Double(goodInterval), unit: .days)
        nextEasy.scheduledDays = Double(easyInterval)
        nextEasy.due = Date.dateScheduler(now: reviewTime, t: Double(easyInterval), unit: .days)
    }

    private func nextStateReview(
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard
    ) {
        nextHard.state = .review
        nextHard.learningSteps = 0
        nextGood.state = .review
        nextGood.learningSteps = 0
        nextEasy.state = .review
        nextEasy.learningSteps = 0
    }
}


// Upstream: Sources/FSRS/Scheduler/FSRSReschedule.swift
//
//  FSRSReschedule.swift
//
//  Created by nkq on 10/15/24.
//

import Foundation

/**
 * The `Reschedule` class provides methods to handle the rescheduling of cards based on their review history.
 * determine the next review dates and update the card's state accordingly.
 */
class FSRSReschedule {
    private var fsrs: FSRS

    /**
     * Creates an instance of the `Reschedule` class.
     * @param fsrs - An instance of the FSRS class used for scheduling.
     */
    init(fsrs: FSRS) {
        self.fsrs = fsrs
    }

    /**
     * Replays a review for a card and determines the next review date based on the given rating.
     * @param card - The card being reviewed.
     * @param reviewed - The date the card was reviewed.
     * @param rating - The grade given to the card during the review.
     * @returns A `RecordLogItem` containing the updated card and review log.
     */
    func replay(
        card: VendorFSRSCard,
        reviewDate: Date,
        rating: Rating
    ) throws -> RecordLogItem {
        try fsrs.next(card: card, now: reviewDate, grade: rating)
    }

    /**
     * Processes a manual review for a card, allowing for custom state, stability, difficulty, and due date.
     * @param card - The card being reviewed.
     * @param state - The state of the card after the review.
     * @param reviewed - The date the card was reviewed.
     * @param elapsed_days - The number of days since the last review.
     * @param stability - (Optional) The stability of the card.
     * @param difficulty - (Optional) The difficulty of the card.
     * @param due - (Optional) The due date for the next review.
     * @returns A `RecordLogItem` containing the updated card and review log.
     * @throws Will throw an error if the state or due date is not provided when required.
     */
    func handleManualRating(
        card: VendorFSRSCard,
        state: CardState,
        reviewDate: Date,
        elapsedDays: Double,
        stability: Double?,
        difficulty: Double?,
        due: Date?
    ) throws -> RecordLogItem {
        var log: ReviewLog
        var nextCard: VendorFSRSCard

        if state == .new {
            log = .init(
                rating: .manual,
                state: state,
                due: due ?? reviewDate,
                stability: card.stability,
                difficulty: card.difficulty,
                elapsedDays: elapsedDays,
                lastElapsedDays: card.elapsedDays,
                scheduledDays: card.scheduledDays,
                review: reviewDate
            )
            nextCard = FSRSDefaults().createEmptyCard(
                now: reviewDate
            )
            nextCard.lastReview = reviewDate
        } else {
            guard let due = due else {
                throw FSRSError(.invalidParam, "reschedule: due is required for manual rating")
            }
            let schduledDays = Date.dateDiff(now: due, pre: reviewDate, unit: .days)
            log = .init(
                rating: .manual,
                state: card.state,
                due: card.lastReview ?? card.due,
                stability: card.stability,
                difficulty: card.difficulty,
                elapsedDays: elapsedDays,
                lastElapsedDays: card.elapsedDays,
                scheduledDays: card.scheduledDays,
                review: reviewDate
            )
            nextCard = .init(
                due: due,
                stability: stability ?? card.stability,
                difficulty: difficulty ?? card.difficulty,
                elapsedDays: elapsedDays,
                scheduledDays: schduledDays,
                reps: card.reps + 1,
                lapses: card.lapses,
                state: state,
                lastReview: reviewDate
            )
        }
        return .init(card: nextCard, log: log)
    }


    /**
     * Reschedules a card based on its review history.
     *
     * @param current_card - The card to be rescheduled.
     * @param reviews - An array of review history objects.
     * @returns An array of record log items representing the rescheduling process.
     */
    func reschedule(
        currentCard: VendorFSRSCard,
        reviews: [ReviewLog]
    ) throws -> [RecordLogItem] {
        var result = [RecordLogItem]()
        var curCard = FSRSDefaults().createEmptyCard(now: currentCard.due)
        for review in reviews {
            var item: RecordLogItem
            if review.rating == .manual {
                var interval = 0.0
                if curCard.state != .new, let lastReview = curCard.lastReview {
                    interval = Date.dateDiff(
                        now: review.review,
                        pre: lastReview,
                        unit: .days
                    )
                }
                guard let state = review.state else {
                    throw FSRSError(.invalidParam, "reschedule: state is required for manual rating")
                }
                item = try handleManualRating(
                    card: curCard,
                    state: state,
                    reviewDate: review.review,
                    elapsedDays: interval,
                    stability: review.stability,
                    difficulty: review.difficulty,
                    due: review.due
                )
                result.append(item)
                curCard = item.card
            } else {
                do {
                    item = try replay(
                        card: curCard, reviewDate: review.review, rating: review.rating
                    )
                    result.append(item)
                    curCard = item.card
                } catch {
                    print(error.localizedDescription)
                }
            }
        }
        return result
    }

    func calculateManualRecord(
        currentCard: VendorFSRSCard,
        now: Date,
        recordLogItem: RecordLogItem?,
        updateMemory: Bool = false
    ) throws -> RecordLogItem? {
        guard let item = recordLogItem else { return nil }
        let rescheduleCard = item.card
        let log = item.log

        var curCard = currentCard.newCard
        if curCard.due.timeIntervalSince1970 == rescheduleCard.due.timeIntervalSince1970 {
            return nil
        }
        curCard.scheduledDays = Date.dateDiff(
            now: rescheduleCard.due,
            pre: curCard.due,
            unit: .days
        )
        return try handleManualRating(
            card: curCard,
            state: rescheduleCard.state,
            reviewDate: now,
            elapsedDays: log.elapsedDays,
            stability: updateMemory ? rescheduleCard.stability : nil,
            difficulty: updateMemory ? rescheduleCard.difficulty : nil,
            due: rescheduleCard.due
        )
    }
}


// Upstream: Sources/FSRS/Scheduler/LongTermScheduler.swift
//
//  LongTermScheduler.swift
//
//  Created by nkq on 10/14/24.
//

import Foundation

class LongTermScheduler: AbstractScheduler {
    override func newState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }

        current.scheduledDays = 0
        current.elapsedDays = 0

        let nextArray = Array(repeating: current.newCard, count: 4)
        var nextAgain = nextArray[0]
        var nextHard = nextArray[1]
        var nextGood = nextArray[2]
        var nextEasy = nextArray[3]

        initDs(&nextAgain, &nextHard, &nextGood, &nextEasy)

        let firstInterval = 0.0

        nextInterval(&nextAgain, &nextHard, &nextGood, &nextEasy, interval: firstInterval)

        nextState(&nextAgain, &nextHard, &nextGood, &nextEasy)

        updateNext(&nextAgain, &nextHard, &nextGood, &nextEasy)

        return next[grade]!
    }

    override func learningState(grade: Rating) throws -> RecordLogItem {
        try reviewState(grade: grade)
    }

    override func reviewState(grade: Rating) throws -> RecordLogItem {
        if let item = next[grade] { return item }

        let interval = current.elapsedDays
        let retrievability = algorithm.forgettingCurve(elapsedDays: interval, stability: last.stability)
        let nextArray = Array(repeating: current.newCard, count: 4)
        var nextAgain = nextArray[0]
        var nextHard = nextArray[1]
        var nextGood = nextArray[2]
        var nextEasy = nextArray[3]

        nextDs(
            &nextAgain, &nextHard, &nextGood, &nextEasy,
            difficulty: last.difficulty,
            stability: last.stability,
            retrievability: retrievability
        )

        nextInterval(&nextAgain, &nextHard, &nextGood, &nextEasy, interval: interval)

        nextState(&nextAgain, &nextHard, &nextGood, &nextEasy)
        nextAgain.lapses += 1

        updateNext(&nextAgain, &nextHard, &nextGood, &nextEasy)

        return next[grade]!
    }

    private func initDs(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard
    ) {
        nextAgain.difficulty = algorithm.initDifficulty(.again)
        nextAgain.stability = algorithm.initStability(g: .again)

        nextHard.difficulty = algorithm.initDifficulty(.hard)
        nextHard.stability = algorithm.initStability(g: .hard)

        nextGood.difficulty = algorithm.initDifficulty(.good)
        nextGood.stability = algorithm.initStability(g: .good)

        nextEasy.difficulty = algorithm.initDifficulty(.easy)
        nextEasy.stability = algorithm.initStability(g: .easy)
    }

    private func nextDs(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard,
        difficulty: Double,
        stability: Double,
        retrievability: Double
    ) {
        nextAgain.difficulty = algorithm.nextDifficulty(d: difficulty, g: .again)
        let sAfterAll = algorithm.nextForgetStability(d: difficulty, s: stability, r: retrievability)
        nextAgain.stability = FSRSHelper.clamp(stability, algorithm.sMin, sAfterAll)

        nextHard.difficulty = algorithm.nextDifficulty(d: difficulty, g: .hard)
        nextHard.stability = algorithm.nextRecallStability(
            d: difficulty, s: stability, r: retrievability, g: .hard
        )

        nextGood.difficulty = algorithm.nextDifficulty(d: difficulty, g: .good)
        nextGood.stability = algorithm.nextRecallStability(
            d: difficulty, s: stability, r: retrievability, g: .good
        )

        nextEasy.difficulty = algorithm.nextDifficulty(d: difficulty, g: .easy)
        nextEasy.stability = algorithm.nextRecallStability(
            d: difficulty, s: stability, r: retrievability, g: .easy
        )
    }

    private func nextInterval(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard,
        interval: Double
    ) {
        let againInterval = algorithm.nextInterval(s: nextAgain.stability, elapsedDays: interval, seed: seed)
        let hardInterval = algorithm.nextInterval(s: nextHard.stability, elapsedDays: interval, seed: seed)
        let goodInterval = algorithm.nextInterval(s: nextGood.stability, elapsedDays: interval, seed: seed)
        let easyInterval = algorithm.nextInterval(s: nextEasy.stability, elapsedDays: interval, seed: seed)


        let newAgainInterval = min(againInterval, hardInterval)
        let newHardInterval = max(hardInterval, (againInterval + 1))
        let newGoodInterval = max(goodInterval, (hardInterval + 1))
        let newEasyInterval = max(easyInterval, (goodInterval + 1))

        nextAgain.scheduledDays = Double(newAgainInterval)
        nextAgain.due = Date.dateScheduler(now: reviewTime, t: Double(newAgainInterval), unit: .days)

        nextHard.scheduledDays = Double(newHardInterval)
        nextHard.due = Date.dateScheduler(now: reviewTime, t: Double(newHardInterval), unit: .days)

        nextGood.scheduledDays = Double(newGoodInterval)
        nextGood.due = Date.dateScheduler(now: reviewTime, t: Double(newGoodInterval), unit: .days)

        nextEasy.scheduledDays = Double(newEasyInterval)
        nextEasy.due = Date.dateScheduler(now: reviewTime, t: Double(newEasyInterval), unit: .days)
    }

    private func nextState(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard
    ) {
        nextAgain.state = .review
        nextHard.state = .review
        nextGood.state = .review
        nextEasy.state = .review
    }

    private func updateNext(
        _ nextAgain: inout VendorFSRSCard,
        _ nextHard: inout VendorFSRSCard,
        _ nextGood: inout VendorFSRSCard,
        _ nextEasy: inout VendorFSRSCard
    ) {
        let again = RecordLogItem(card: nextAgain, log: buildLog(rating: .again))
        let hard = RecordLogItem(card: nextHard, log: buildLog(rating: .hard))
        let good = RecordLogItem(card: nextGood, log: buildLog(rating: .good))
        let easy = RecordLogItem(card: nextEasy, log: buildLog(rating: .easy))

        next[.again] = again
        next[.hard] = hard
        next[.good] = good
        next[.easy] = easy
    }
}
