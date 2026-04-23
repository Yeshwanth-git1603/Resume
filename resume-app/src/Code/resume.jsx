import { useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
).toString();

const SKILL_COLORS = [
    "#00D4AA", "#FF6B6B", "#4ECDC4", "#FFE66D", "#A8E6CF",
    "#FF8B94", "#B8B8FF", "#FFDAC1", "#E2F0CB", "#C7CEEA"
];

const JOB_PLATFORMS = [
    { name: "LinkedIn", color: "#0077B5", icon: "💼", baseUrl: "https://www.linkedin.com/jobs/search/?keywords=" },
    { name: "Indeed", color: "#003A9B", icon: "🔍", baseUrl: "https://www.indeed.com/jobs?q=" },
    { name: "Glassdoor", color: "#0CAA41", icon: "🚪", baseUrl: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword=" },
    { name: "Naukri", color: "#F34F29", icon: "🌐", baseUrl: "https://www.naukri.com/search?q=" },
    { name: "Monster", color: "#6E4FBF", icon: "👾", baseUrl: "https://www.monster.com/jobs/search?q=" },
];

function buildJobLinks(jobTitle) {
    const encoded = encodeURIComponent(jobTitle);
    return JOB_PLATFORMS.map(p => ({ ...p, url: p.baseUrl + encoded }));
}

export default function JobMatcher() {
    const [resumeText, setResumeText] = useState("");
    const [skills, setSkills] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pdfProgress, setPdfProgress] = useState(0);
    const [analysisProgress, setAnalysisProgress] = useState(0);
    const [step, setStep] = useState("input"); // input | results
    const [error, setError] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [apiKey] = useState(import.meta.env.VITE_OPENAI_API_KEY || "");

    const extractSkillsAndJobs = async (text) => {
        setLoading(true);
        setError("");
        setAnalysisProgress(5);

        // Simulated progress interval for AI
        const interval = setInterval(() => {
            setAnalysisProgress(prev => (prev < 90 ? prev + Math.random() * 15 : prev));
        }, 600);

        try {
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey.trim()}`
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "user",
                            content: `Analyze this resume text and extract skills and recommend jobs. Respond ONLY with a JSON object, no markdown, no backticks, no explanation.\n\nResume:\n"""\n${text.slice(0, 3000)}\n"""\n\nReturn exactly this JSON structure:\n{\n  "skills": ["skill1", "skill2", ...], \n  "jobs": [\n    {\n      "title": "Job Title",\n      "match": 95,\n      "reason": "One sentence why this matches",\n      "level": "Entry/Mid/Senior",\n      "salary": "$XX,000 - $XX,000"\n    }\n  ]\n}\n\nExtract 8-15 key technical and soft skills. Recommend 6-8 job roles sorted by match percentage (highest first). Be specific with job titles.`
                        }
                    ],
                    temperature: 0.3
                })
            });
            const data = await response.json();

            if (!response.ok) {
                console.error("OpenAI API Error:", data);
                const errMsg = typeof data.error === 'string' ? data.error : data.error?.message;
                throw new Error(`API Error: ${errMsg || response.statusText}`);
            }

            if (!data.choices || data.choices.length === 0) {
                console.error("No choices returned. Response:", data);
                throw new Error("No response generated. This might be due to safety filters or an invalid request.");
            }

            const raw = data.choices[0]?.message?.content || "";
            if (!raw) {
                throw new Error("API returned an empty text response.");
            }

            const clean = raw.replace(/```(?:json)?\n?|```/gi, "").trim();

            let parsed;
            try {
                parsed = JSON.parse(clean);
            } catch (parseError) {
                console.error("JSON Parse Error. Raw response:", raw);
                throw new Error("Failed to parse the AI response. The AI didn't return valid JSON.");
            }

            setSkills(parsed.skills || []);
            setJobs((parsed.jobs || []).map(j => ({ ...j, links: buildJobLinks(j.title) })));
            setStep("results");
        } catch (e) {
            console.error("Analysis Exception:", e);
            setError(e.message || "Failed to analyze resume. Please check your network and text and try again.");
        } finally {
            clearInterval(interval);
            setAnalysisProgress(100);
            setTimeout(() => {
                setLoading(false);
                setAnalysisProgress(0);
            }, 500);
        }
    };

    const handleFile = useCallback(async (file) => {
        if (!file) return;
        setError("");
        const name = file.name.toLowerCase();

        if (name.endsWith(".pdf")) {
            setPdfProgress(2);
            try {
                const arrayBuffer = await file.arrayBuffer();
                setPdfProgress(10);
                const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
                setPdfProgress(20);
                const total = pdf.numPages;
                let completed = 0;
                const pagesText = [];
                for (let i = 1; i <= total; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    pagesText.push(textContent.items.map(item => item.str).join(" "));
                    completed++;
                    setPdfProgress(Math.floor(20 + (completed / total) * 75));
                }
                const fullText = pagesText.join("\n").trim();
                if (!fullText) throw new Error("No text found — this may be a scanned/image PDF.");
                setResumeText(fullText);
                setPdfProgress(100);
                setTimeout(() => setPdfProgress(0), 1200);
            } catch (err) {
                console.error("PDF error:", err);
                setError(`PDF Error: ${err.message || "Could not read this PDF."}`);
                setPdfProgress(0);
            }
        } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
            setPdfProgress(2);
            try {
                const arrayBuffer = await file.arrayBuffer();
                setPdfProgress(40);
                const result = await mammoth.extractRawText({ arrayBuffer });
                setPdfProgress(90);
                const text = result.value.trim();
                if (!text) throw new Error("No text found in this document.");
                setResumeText(text);
                setPdfProgress(100);
                setTimeout(() => setPdfProgress(0), 1200);
            } catch (err) {
                console.error("DOCX error:", err);
                setError(`DOCX Error: ${err.message || "Could not read this document."}`);
                setPdfProgress(0);
            }
        } else {
            const reader = new FileReader();
            reader.onload = (e) => setResumeText(e.target.result);
            reader.readAsText(file);
        }
    }, []);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    const reset = () => {
        setStep("input");
        setSkills([]);
        setJobs([]);
        setResumeText("");
        setError("");
    };

    return (
        <div style={{
            minHeight: "100vh",
            background: "linear-gradient(135deg, #0a0a0f 0%, #0d1117 50%, #0a0f1e 100%)",
            fontFamily: "'Georgia', serif",
            color: "#e8e8e8",
            padding: "0",
            position: "relative",
            overflow: "hidden"
        }}>
            {/* Ambient background orbs */}
            <div style={{
                position: "fixed", top: "-20%", left: "-10%",
                width: "500px", height: "500px",
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(0,212,170,0.08) 0%, transparent 70%)",
                pointerEvents: "none"
            }} />
            <div style={{
                position: "fixed", bottom: "-20%", right: "-10%",
                width: "600px", height: "600px",
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(100,100,255,0.07) 0%, transparent 70%)",
                pointerEvents: "none"
            }} />

            <div style={{ maxWidth: "860px", margin: "0 auto", padding: "48px 24px" }}>

                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: "52px" }}>
                    <div style={{
                        display: "inline-block",
                        background: "linear-gradient(90deg, #00D4AA, #6464ff)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        fontSize: "13px",
                        letterSpacing: "4px",
                        textTransform: "uppercase",
                        marginBottom: "12px",
                        fontFamily: "monospace"
                    }}>AI-Powered Career Intelligence</div>
                    <h1 style={{
                        fontSize: "clamp(32px, 6vw, 54px)",
                        fontWeight: "400",
                        letterSpacing: "-1px",
                        lineHeight: "1.15",
                        margin: "0 0 16px",
                        color: "#f0f0f0"
                    }}>
                        Resume <span style={{ fontStyle: "italic", color: "#00D4AA" }}>→</span> Dream Job
                    </h1>
                    <p style={{ color: "#666", fontSize: "16px", maxWidth: "460px", margin: "0 auto", lineHeight: "1.6" }}>
                        Paste your resume, let AI extract your skills, and get matched to the best jobs across top platforms.
                    </p>
                </div>

                {step === "input" && (
                    <div>


                        {/* Drop zone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            style={{
                                border: `2px dashed ${pdfProgress > 0 ? "#00D4AA" : dragOver ? "#00D4AA" : "#2a2a3a"}`,
                                borderRadius: "16px",
                                padding: "28px",
                                marginBottom: "20px",
                                textAlign: "center",
                                background: pdfProgress > 0 ? "rgba(0,212,170,0.04)" : dragOver ? "rgba(0,212,170,0.05)" : "rgba(255,255,255,0.02)",
                                transition: "all 0.2s",
                                cursor: pdfProgress > 0 ? "default" : "pointer"
                            }}
                            onClick={() => pdfProgress === 0 && document.getElementById("fileInput").click()}
                        >
                            {pdfProgress > 0 ? (
                                <>
                                    <div style={{ fontSize: "32px", marginBottom: "8px" }}>⏳</div>
                                    <div style={{ color: "#00D4AA", fontSize: "14px", fontFamily: "monospace" }}>
                                        Processing PDF... {pdfProgress}%
                                    </div>
                                    <div style={{ width: "100%", height: "6px", background: "rgba(0,0,0,0.3)", borderRadius: "3px", overflow: "hidden", marginTop: "12px" }}>
                                        <div style={{
                                            width: `${pdfProgress}%`,
                                            height: "100%",
                                            background: "linear-gradient(90deg, #00D4AA, #6464ff)",
                                            borderRadius: "3px",
                                            transition: "width 0.3s ease"
                                        }} />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: "32px", marginBottom: "8px" }}>📄</div>
                                    <div style={{ color: "#888", fontSize: "14px" }}>
                                        Drag & drop a <strong style={{ color: "#aaa" }}>.pdf</strong>, <strong style={{ color: "#aaa" }}>.docx</strong>, or <strong style={{ color: "#aaa" }}>.txt</strong> resume here, or{" "}
                                        <span style={{ color: "#00D4AA", cursor: "pointer" }}>click to browse</span>
                                    </div>
                                </>
                            )}
                            <input
                                id="fileInput"
                                type="file"
                                accept=".txt,.text,.pdf,.doc,.docx"
                                style={{ display: "none" }}
                                onChange={(e) => handleFile(e.target.files[0])}
                            />
                        </div>

                        {/* Progress Bars (PDF or AI) */}
                        {(pdfProgress > 0 || analysisProgress > 0) && (
                            <div style={{ marginBottom: "24px", padding: "18px", background: "rgba(255,255,255,0.02)", border: "1px solid #1e1e2e", borderRadius: "16px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#888", marginBottom: "10px", fontFamily: "monospace" }}>
                                    <span>
                                        {analysisProgress > 0 ? "AI Analysis in progress..." : "Processing document..."}
                                    </span>
                                    <span style={{ color: "#00D4AA" }}>{analysisProgress || pdfProgress}%</span>
                                </div>
                                <div style={{ width: "100%", height: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "4px", overflow: "hidden" }}>
                                    <div style={{
                                        width: `${analysisProgress || pdfProgress}%`,
                                        height: "100%",
                                        background: "linear-gradient(90deg, #00D4AA, #6464ff)",
                                        borderRadius: "4px",
                                        transition: "width 0.4s cubic-bezier(0.1, 0.7, 0.1, 1)"
                                    }} />
                                </div>
                            </div>
                        )}

                        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
                            <div style={{ flex: 1, height: "1px", background: "#1e1e2e" }} />
                            <span style={{ color: "#444", fontSize: "13px", fontFamily: "monospace" }}>OR PASTE BELOW</span>
                            <div style={{ flex: 1, height: "1px", background: "#1e1e2e" }} />
                        </div>

                        {/* Textarea */}
                        <textarea
                            value={resumeText}
                            onChange={(e) => setResumeText(e.target.value)}
                            placeholder={`Paste your resume here...\n\nExample:\nJohn Doe | Software Engineer\nSkills: React, Python, Node.js, AWS, Docker\nExperience: 3 years at TechCorp building scalable APIs...\nEducation: B.Tech Computer Science`}
                            style={{
                                width: "100%",
                                minHeight: "260px",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid #1e1e2e",
                                borderRadius: "16px",
                                color: "#d8d8d8",
                                fontSize: "14px",
                                lineHeight: "1.7",
                                padding: "20px",
                                resize: "vertical",
                                outline: "none",
                                fontFamily: "monospace",
                                boxSizing: "border-box",
                                transition: "border-color 0.2s"
                            }}
                            onFocus={e => e.target.style.borderColor = "#00D4AA33"}
                            onBlur={e => e.target.style.borderColor = "#1e1e2e"}
                        />

                        {error && (
                            <div style={{
                                marginTop: "16px", padding: "14px 18px",
                                background: "rgba(255,80,80,0.1)",
                                border: "1px solid rgba(255,80,80,0.3)",
                                borderRadius: "10px", color: "#ff8080", fontSize: "14px"
                            }}>{error}</div>
                        )}

                        <button
                            onClick={() => resumeText.trim().length > 50 && extractSkillsAndJobs(resumeText)}
                            disabled={loading || resumeText.trim().length < 50}
                            style={{
                                marginTop: "24px",
                                width: "100%",
                                padding: "18px",
                                background: loading || resumeText.trim().length < 50
                                    ? "#1a1a2a"
                                    : "linear-gradient(135deg, #00D4AA, #00a88a)",
                                color: loading || resumeText.trim().length < 50 ? "#444" : "#000",
                                border: "none",
                                borderRadius: "14px",
                                fontSize: "16px",
                                fontWeight: "600",
                                cursor: loading || resumeText.trim().length < 50 ? "not-allowed" : "pointer",
                                letterSpacing: "0.5px",
                                transition: "all 0.2s",
                                fontFamily: "monospace"
                            }}
                        >
                            {loading ? "⚙️  Analyzing Resume..." : "✦  Analyze & Match Jobs"}
                        </button>
                    </div>
                )}

                {step === "results" && (
                    <div>
                        {/* Skills Section */}
                        <div style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid #1a1a2a",
                            borderRadius: "20px",
                            padding: "28px",
                            marginBottom: "28px"
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
                                <span style={{ fontSize: "20px" }}>⚡</span>
                                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "500", color: "#f0f0f0" }}>
                                    Extracted Skills
                                </h2>
                                <span style={{
                                    marginLeft: "auto",
                                    background: "rgba(0,212,170,0.15)",
                                    color: "#00D4AA",
                                    fontSize: "12px",
                                    padding: "3px 10px",
                                    borderRadius: "20px",
                                    fontFamily: "monospace"
                                }}>{skills.length} found</span>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                                {skills.map((skill, i) => (
                                    <span key={i} style={{
                                        background: `${SKILL_COLORS[i % SKILL_COLORS.length]}18`,
                                        border: `1px solid ${SKILL_COLORS[i % SKILL_COLORS.length]}40`,
                                        color: SKILL_COLORS[i % SKILL_COLORS.length],
                                        padding: "6px 14px",
                                        borderRadius: "30px",
                                        fontSize: "13px",
                                        fontFamily: "monospace",
                                        letterSpacing: "0.3px"
                                    }}>{skill}</span>
                                ))}
                            </div>
                        </div>

                        {/* Jobs Section */}
                        <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "20px" }}>🎯</span>
                            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "500", color: "#f0f0f0" }}>
                                Recommended Jobs
                            </h2>
                            <span style={{
                                marginLeft: "auto",
                                background: "rgba(100,100,255,0.15)",
                                color: "#8888ff",
                                fontSize: "12px",
                                padding: "3px 10px",
                                borderRadius: "20px",
                                fontFamily: "monospace"
                            }}>{jobs.length} matches</span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            {jobs.map((job, i) => (
                                <div key={i} style={{
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid #1a1a2a",
                                    borderRadius: "18px",
                                    padding: "24px",
                                    transition: "border-color 0.2s"
                                }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = "#2a2a4a"}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a2a"}
                                >
                                    {/* Job header */}
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "14px", flexWrap: "wrap" }}>
                                        <div style={{ flex: 1, minWidth: "200px" }}>
                                            <div style={{ fontSize: "18px", fontWeight: "500", color: "#f0f0f0", marginBottom: "4px" }}>
                                                {job.title}
                                            </div>
                                            <div style={{ fontSize: "13px", color: "#666" }}>{job.reason}</div>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                                            {/* Match bar */}
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                <div style={{
                                                    width: "80px", height: "6px",
                                                    background: "#1a1a2a",
                                                    borderRadius: "3px", overflow: "hidden"
                                                }}>
                                                    <div style={{
                                                        width: `${job.match}%`, height: "100%",
                                                        background: job.match >= 85
                                                            ? "linear-gradient(90deg, #00D4AA, #00ff99)"
                                                            : job.match >= 70
                                                                ? "linear-gradient(90deg, #FFE66D, #ffb347)"
                                                                : "linear-gradient(90deg, #FF8B94, #ff6b6b)",
                                                        borderRadius: "3px"
                                                    }} />
                                                </div>
                                                <span style={{
                                                    fontSize: "13px", fontFamily: "monospace",
                                                    color: job.match >= 85 ? "#00D4AA" : job.match >= 70 ? "#FFE66D" : "#FF8B94",
                                                    fontWeight: "600"
                                                }}>{job.match}%</span>
                                            </div>
                                            <div style={{ display: "flex", gap: "8px" }}>
                                                <span style={{
                                                    background: "#1a1a2a", color: "#888",
                                                    fontSize: "11px", padding: "3px 8px", borderRadius: "6px", fontFamily: "monospace"
                                                }}>{job.level}</span>
                                                <span style={{
                                                    background: "#1a1a2a", color: "#888",
                                                    fontSize: "11px", padding: "3px 8px", borderRadius: "6px", fontFamily: "monospace"
                                                }}>{job.salary}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Platform links */}
                                    <div style={{
                                        borderTop: "1px solid #1a1a2a",
                                        paddingTop: "14px",
                                        display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center"
                                    }}>
                                        <span style={{ fontSize: "12px", color: "#444", fontFamily: "monospace", marginRight: "4px" }}>
                                            Apply on →
                                        </span>
                                        {job.links.map((link, j) => (
                                            <a
                                                key={j}
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "5px",
                                                    padding: "6px 12px",
                                                    background: `${link.color}18`,
                                                    border: `1px solid ${link.color}30`,
                                                    borderRadius: "8px",
                                                    color: link.color,
                                                    fontSize: "12px",
                                                    textDecoration: "none",
                                                    fontFamily: "monospace",
                                                    transition: "all 0.15s"
                                                }}
                                                onMouseEnter={e => {
                                                    e.currentTarget.style.background = `${link.color}30`;
                                                    e.currentTarget.style.transform = "translateY(-1px)";
                                                }}
                                                onMouseLeave={e => {
                                                    e.currentTarget.style.background = `${link.color}18`;
                                                    e.currentTarget.style.transform = "translateY(0)";
                                                }}
                                            >
                                                {link.icon} {link.name} ↗
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Back button */}
                        <button
                            onClick={reset}
                            style={{
                                marginTop: "32px",
                                width: "100%",
                                padding: "16px",
                                background: "transparent",
                                color: "#555",
                                border: "1px solid #1e1e2e",
                                borderRadius: "14px",
                                fontSize: "14px",
                                cursor: "pointer",
                                fontFamily: "monospace",
                                transition: "all 0.2s",
                                letterSpacing: "0.5px"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#888"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e2e"; e.currentTarget.style.color = "#555"; }}
                        >
                            ← Analyze Another Resume
                        </button>
                    </div>
                )}

                {/* Footer */}
                <div style={{ textAlign: "center", marginTop: "48px", color: "#2a2a3a", fontSize: "12px", fontFamily: "monospace" }}>
                    RESUME MATCHER · POWERED BY OPENAI
                </div>
            </div>
        </div>
    );
}
