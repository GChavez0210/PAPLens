const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const templatePath = path.join(__dirname, 'report.html');
const templateStr = fs.readFileSync(templatePath, 'utf8');
const template = Handlebars.compile(templateStr);

const mockPayload = {
    report: {
        generatedAt: new Date().toLocaleString(),
        rangeLabel: 'Last 30 Days',
        sleepBoundaryLabel: 'Noon-to-Noon (Start: 12:00)',
        footerRight: 'Page 1 of 1'
    },
    profile: {
        name: 'John Doe',
        age: 45,
        notes: 'Generated from PAPLens Desktop.'
    },
    device: {
        model: 'AirSense 10',
        manufacturer: 'ResMed',
        serialNumber: '23192039120',
        firmware: 'SX583-0291'
    },
    summary: { // legacy but required by template? - double check
        avgAhi: '1.2',
        ahiStatusClass: 'good',
        ahiStatusLabel: 'Adequate',
        avgUsage: '7.5',
        usageStatusClass: 'good',
        usageStatusLabel: 'Good',
        leakTypical: '12',
        leakStatusClass: 'good',
        leakStatusLabel: 'Normal'
    },
    summaryScores: { // The new fields!
        stabilityScore: 92,
        stabilityClass: 'good',
        stabilityLabel: 'Optimal',
        maskFitScore: 88,
        maskFitClass: 'good',
        maskFitLabel: 'Good',
        explanations: {
            stability: 'Computed: Measures night-to-night consistency across AHI, leak, and pressure. Higher is more stable.',
            maskFit: 'Computed: Evaluates average flow leak limits and maximum leak occurrences over the period.'
        }
    },
    correlations: {
        windowDays: 30,
        pairs: [
            {
                pair: 'Leak ↔ AHI',
                r: 0.85,
                n: 30,
                label: 'Strong',
                plain: 'Strong positive. Leak is a major driver of elevated AHI and should be prioritized for correction.'
            }
        ]
    }
};

const compiledHtml = template(mockPayload);

console.log("=== HANDLEBARS ASSERTION TEST ===");
const hasStability = compiledHtml.includes("Stability Score") && compiledHtml.includes("92");
const hasMaskFit = compiledHtml.includes("Mask Fit Score") && compiledHtml.includes("88");
const hasCorrelationPair = compiledHtml.includes("Leak ↔ AHI");
const hasCorrelationText = compiledHtml.includes("Strong positive. Leak is a major driver of elevated AHI");
const hasFormulaSection = compiledHtml.includes("How key metrics are calculated");

console.log(`Stability Binding OK: ${hasStability}`);
console.log(`MaskFit Binding OK: ${hasMaskFit}`);
console.log(`Correlation Pair Binding OK: ${hasCorrelationPair}`);
console.log(`Correlation Label Binding OK: ${hasCorrelationText}`);
console.log(`Formula Section Rendered: ${hasFormulaSection}`);
