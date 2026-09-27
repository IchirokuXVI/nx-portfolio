package com.ichirokuxvi.shopwalk.engine

/** How a PDR step turns into metres (recorder plan 0002, section 5.5). */
enum class StepModel(val id: String) {
    FIXED("fixed"),
    WEINBERG("weinberg");

    companion object {
        fun of(id: String?): StepModel = entries.firstOrNull { it.id == id } ?: FIXED
    }
}

/**
 * Every numeric parameter of recorder plan 0002, section 5, with the contract's default.
 * The TypeScript twin uses the same numbers, so the same file gives the same answer.
 */
data class EngineOptions(
    // 5.1 own step detector
    val stepFastTauS: Double = 0.06,
    val stepBaseTauS: Double = 1.5,
    val stepRiseMs2: Double = 0.8,
    val stepFallMs2: Double = 0.2,
    val stepRefractoryMs: Double = 280.0,
    val stepWarmupMs: Double = 1000.0,
    // 5.2 gyro heading
    val gravityTauS: Double = 0.5,
    // 5.4 square turns
    val settleRateDegPerS: Double = 20.0,
    val settleMs: Double = 400.0,
    val turnThresholdDeg: Double = 60.0,
    val turnQuantumDeg: Double = 90.0,
    val confidenceTauS: Double = 60.0,
    // 5.5 step length
    val stepModel: StepModel = StepModel.FIXED,
    val stepMetres: Double = 0.7,
    val weinbergK: Double = 0.48,
    // 5.6 alignment
    val alignMetres: Double = 3.0,
) {
    companion object {
        /** The defaults, with the step length taken from the walk's settings. */
        fun forWalk(walk: WalkFile): EngineOptions = EngineOptions(stepMetres = walk.settings.stepMetres)
    }
}
