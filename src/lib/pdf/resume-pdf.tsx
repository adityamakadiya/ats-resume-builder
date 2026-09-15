import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import type { ResumeFacts, TailoredResume } from "@/lib/schemas";

/**
 * Deliberately plain. Every choice here is an ATS-parsing choice:
 *  - Helvetica is a PDF base-14 font, so the text layer extracts as real text
 *    on every parser rather than as embedded-subset glyphs.
 *  - One linear column. Nothing sits side by side, so extraction order is
 *    reading order — the failure mode that silently scrambles two-column
 *    resumes never arises.
 *  - Conventional section headings, because keyword-based parsers segment on
 *    exactly these strings.
 *  - No tables, text boxes, icons, logos, or background graphics.
 */

const styles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 34,
    paddingHorizontal: 42,
    fontFamily: "Helvetica",
    fontSize: 9.6,
    lineHeight: 1.38,
    color: "#111111",
  },
  name: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  headline: { fontSize: 10.5, color: "#333333", marginBottom: 4 },
  contact: { fontSize: 9, color: "#333333", marginBottom: 12 },
  sectionHeading: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    marginTop: 11,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: "#999999",
  },
  entryTitle: { fontSize: 10.2, fontFamily: "Helvetica-Bold", marginTop: 6 },
  entryMeta: { fontSize: 9.2, color: "#333333", marginBottom: 2.5 },
  bullet: { marginBottom: 2, paddingLeft: 10, textIndent: -10 },
  paragraph: { marginBottom: 2 },
  skillLine: { marginBottom: 2.5 },
  skillCategory: { fontFamily: "Helvetica-Bold" },
});

const HEADINGS: Record<string, string> = {
  summary: "PROFESSIONAL SUMMARY",
  skills: "TECHNICAL SKILLS",
  experience: "PROFESSIONAL EXPERIENCE",
  projects: "PROJECTS",
  education: "EDUCATION",
  certifications: "CERTIFICATIONS",
};

const Heading = ({ children }: { children: string }) => (
  <Text style={styles.sectionHeading}>{children}</Text>
);

const Bullet = ({ children }: { children: string }) => (
  <Text style={styles.bullet}>{`•  ${children}`}</Text>
);

function ResumeDocument({
  tailored,
  facts,
}: {
  tailored: TailoredResume;
  facts: ResumeFacts;
}) {
  const { contact } = facts;
  const contactLine = [
    contact.location,
    contact.phone,
    contact.email,
    ...contact.links.map((l) => l.url.replace(/^https?:\/\//, "")),
  ]
    .filter(Boolean)
    .join("  |  ");

  const order = tailored.sectionOrder.filter((k) => k in HEADINGS);
  const known = new Set(order);
  for (const k of Object.keys(HEADINGS)) if (!known.has(k)) order.push(k);

  const renderSection = (key: string) => {
    switch (key) {
      case "summary":
        return tailored.summary.text ? (
          <View key={key} wrap={false}>
            <Heading>{HEADINGS.summary}</Heading>
            <Text style={styles.paragraph}>{tailored.summary.text}</Text>
          </View>
        ) : null;

      case "skills":
        return tailored.skills.length ? (
          <View key={key}>
            <Heading>{HEADINGS.skills}</Heading>
            {tailored.skills.map((group, i) => (
              <Text key={i} style={styles.skillLine}>
                <Text style={styles.skillCategory}>{group.category}: </Text>
                {group.items.join(", ")}
              </Text>
            ))}
          </View>
        ) : null;

      case "experience":
        return tailored.experience.length ? (
          <View key={key}>
            <Heading>{HEADINGS.experience}</Heading>
            {tailored.experience.map((exp, i) => (
              <View key={i} wrap={false}>
                <Text style={styles.entryTitle}>{exp.title}</Text>
                <Text style={styles.entryMeta}>
                  {[exp.company, exp.location, `${exp.startDate} - ${exp.endDate}`]
                    .filter(Boolean)
                    .join("  |  ")}
                </Text>
                {exp.bullets.map((b, j) => (
                  <Bullet key={j}>{b.text}</Bullet>
                ))}
              </View>
            ))}
          </View>
        ) : null;

      case "projects":
        return tailored.projects.length ? (
          <View key={key}>
            <Heading>{HEADINGS.projects}</Heading>
            {tailored.projects.map((p, i) => (
              <View key={i} wrap={false}>
                <Text style={styles.entryTitle}>{p.name}</Text>
                {p.url ? (
                  <Text style={styles.entryMeta}>{p.url.replace(/^https?:\/\//, "")}</Text>
                ) : null}
                {p.bullets.map((b, j) => (
                  <Bullet key={j}>{b.text}</Bullet>
                ))}
              </View>
            ))}
          </View>
        ) : null;

      case "education":
        return tailored.education.length ? (
          <View key={key} wrap={false}>
            <Heading>{HEADINGS.education}</Heading>
            {tailored.education.map((ed, i) => (
              <View key={i}>
                <Text style={styles.entryTitle}>{ed.degree}</Text>
                <Text style={styles.entryMeta}>
                  {[ed.institution, ed.dates].filter(Boolean).join("  |  ")}
                </Text>
              </View>
            ))}
          </View>
        ) : null;

      case "certifications":
        return tailored.certifications.length ? (
          <View key={key} wrap={false}>
            <Heading>{HEADINGS.certifications}</Heading>
            {tailored.certifications.map((c, i) => (
              <Bullet key={i}>{c.text}</Bullet>
            ))}
          </View>
        ) : null;

      default:
        return null;
    }
  };

  return (
    <Document
      title={`${contact.name} - Resume`}
      author={contact.name}
      subject={tailored.headline}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{contact.name}</Text>
        {tailored.headline ? <Text style={styles.headline}>{tailored.headline}</Text> : null}
        {contactLine ? <Text style={styles.contact}>{contactLine}</Text> : null}
        {order.map(renderSection)}
      </Page>
    </Document>
  );
}

export async function renderResumePdf(
  tailored: TailoredResume,
  facts: ResumeFacts,
): Promise<Buffer> {
  return renderToBuffer(<ResumeDocument tailored={tailored} facts={facts} />);
}
