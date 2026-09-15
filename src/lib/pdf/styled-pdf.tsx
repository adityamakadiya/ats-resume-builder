import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { StyleProfile } from "@/lib/ingest/layout";
import type { ResumeFacts, TailoredResume } from "@/lib/schemas";

/**
 * Visual-preservation renderer for PDF uploads.
 *
 * A PDF has no paragraphs to edit — only glyphs at coordinates — and the
 * rewritten bullets are a different length, so there is nothing to reflow them.
 * What can be done honestly is to measure the original (page size, margins,
 * type ladder, accent colour, bullet glyph, column structure) and rebuild in
 * that shape. The result looks like the candidate's resume. It is not their
 * file, and the UI says so rather than implying a fidelity that is not there.
 *
 * Font matching is deliberately coarse: @react-pdf ships the PDF base-14
 * families, and a base-14 face keeps the text layer extractable, which matters
 * more for this document than matching a foundry exactly.
 */

const FAMILIES = {
  serif: { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" },
  sans: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" },
};

const HEADINGS: Record<string, string> = {
  summary: "SUMMARY",
  skills: "TECHNICAL SKILLS",
  experience: "EXPERIENCE",
  projects: "PROJECTS",
  education: "EDUCATION",
  certifications: "CERTIFICATIONS",
};

/** Sections that belong in the narrow band of a two-column resume. */
const SIDEBAR_SECTIONS = new Set(["skills", "education", "certifications"]);

function buildStyles(profile: StyleProfile) {
  const fam = profile.serif ? FAMILIES.serif : FAMILIES.sans;
  const { body, heading, name, small } = profile.fontSizes;
  const accent = profile.accentColor ?? "#111111";
  const lh = Math.min(1.7, Math.max(1.1, profile.bodyLineHeight || 1.35));

  return StyleSheet.create({
    page: {
      paddingTop: profile.margins.top,
      paddingBottom: profile.margins.bottom,
      paddingLeft: profile.margins.left,
      paddingRight: profile.margins.right,
      fontFamily: fam.regular,
      fontSize: body,
      lineHeight: lh,
      color: "#111111",
    },
    name: {
      fontSize: name,
      fontFamily: fam.bold,
      color: accent,
      textAlign: "center",
      marginBottom: 2,
    },
    contact: { fontSize: small, textAlign: "center", marginBottom: 2 },
    headline: { fontSize: small, textAlign: "center", marginBottom: 6 },
    sectionHeading: {
      fontSize: heading,
      fontFamily: fam.bold,
      color: accent,
      marginTop: body * 0.9,
      marginBottom: 2,
      paddingBottom: 1.5,
      borderBottomWidth: 0.7,
      borderBottomColor: accent,
    },
    entryTitle: { fontSize: body, fontFamily: fam.bold, marginTop: body * 0.5 },
    entryMeta: { fontSize: small, fontFamily: fam.italic, marginBottom: 1.5 },
    bullet: { marginBottom: 1.5, paddingLeft: body, textIndent: -body },
    paragraph: { marginBottom: 1.5 },
    skillLine: { marginBottom: 2 },
    skillCategory: { fontFamily: fam.bold },
    columns: { flexDirection: "row" },
  });
}

export async function renderStyledPdf(
  tailored: TailoredResume,
  facts: ResumeFacts,
  profile: StyleProfile,
): Promise<Buffer> {
  const styles = buildStyles(profile);
  const { contact } = facts;

  const contactLine = [
    contact.email,
    contact.phone,
    contact.location,
    ...contact.links.map((l) => l.url.replace(/^https?:\/\//, "")),
  ]
    .filter(Boolean)
    .join("  |  ");

  const order = tailored.sectionOrder.filter((k) => k in HEADINGS);
  for (const k of Object.keys(HEADINGS)) if (!order.includes(k)) order.push(k);

  const Bullet = ({ children }: { children: string }) => (
    <Text style={styles.bullet}>{`${profile.bulletGlyph}  ${children}`}</Text>
  );

  const Section = ({ id }: { id: string }) => {
    switch (id) {
      case "summary":
        if (!tailored.summary.text) return null;
        return (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>{HEADINGS.summary}</Text>
            <Text style={styles.paragraph}>{tailored.summary.text}</Text>
          </View>
        );
      case "skills":
        if (!tailored.skills.length) return null;
        return (
          <View>
            <Text style={styles.sectionHeading}>{HEADINGS.skills}</Text>
            {tailored.skills.map((g, i) => (
              <Text key={i} style={styles.skillLine}>
                <Text style={styles.skillCategory}>{g.category}: </Text>
                {g.items.join(", ")}
              </Text>
            ))}
          </View>
        );
      case "experience":
        if (!tailored.experience.length) return null;
        return (
          <View>
            <Text style={styles.sectionHeading}>{HEADINGS.experience}</Text>
            {tailored.experience.map((e, i) => (
              <View key={i} wrap={false}>
                <Text style={styles.entryTitle}>{e.title}</Text>
                <Text style={styles.entryMeta}>
                  {[e.company, e.location, `${e.startDate} - ${e.endDate}`].filter(Boolean).join("  |  ")}
                </Text>
                {e.bullets.map((b, j) => (
                  <Bullet key={j}>{b.text}</Bullet>
                ))}
              </View>
            ))}
          </View>
        );
      case "projects":
        if (!tailored.projects.length) return null;
        return (
          <View>
            <Text style={styles.sectionHeading}>{HEADINGS.projects}</Text>
            {tailored.projects.map((p, i) => (
              <View key={i} wrap={false}>
                <Text style={styles.entryTitle}>{p.name}</Text>
                {p.url ? <Text style={styles.entryMeta}>{p.url.replace(/^https?:\/\//, "")}</Text> : null}
                {p.bullets.map((b, j) => (
                  <Bullet key={j}>{b.text}</Bullet>
                ))}
              </View>
            ))}
          </View>
        );
      case "education":
        if (!tailored.education.length) return null;
        return (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>{HEADINGS.education}</Text>
            {tailored.education.map((ed, i) => (
              <View key={i}>
                <Text style={styles.entryTitle}>{ed.degree}</Text>
                <Text style={styles.entryMeta}>
                  {[ed.institution, ed.dates].filter(Boolean).join("  |  ")}
                </Text>
              </View>
            ))}
          </View>
        );
      case "certifications":
        if (!tailored.certifications.length) return null;
        return (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>{HEADINGS.certifications}</Text>
            {tailored.certifications.map((c, i) => (
              <Bullet key={i}>{c.text}</Bullet>
            ))}
          </View>
        );
      default:
        return null;
    }
  };

  const Header = () => (
    <View>
      <Text style={styles.name}>{contact.name}</Text>
      {contactLine ? <Text style={styles.contact}>{contactLine}</Text> : null}
      {tailored.headline ? <Text style={styles.headline}>{tailored.headline}</Text> : null}
    </View>
  );

  let body: React.ReactElement;

  if (profile.columnCount === 2 && profile.columnBands.length === 2) {
    const [left, right] = profile.columnBands;
    const leftWidth = left.end - left.start;
    const rightWidth = right.end - right.start;
    const total = leftWidth + rightWidth || 1;
    const leftPct = `${Math.round((leftWidth / total) * 100)}%`;
    const rightPct = `${Math.round((rightWidth / total) * 100)}%`;
    const narrowIsLeft = leftWidth <= rightWidth;

    const sidebar = order.filter((k) => SIDEBAR_SECTIONS.has(k));
    const main = order.filter((k) => !SIDEBAR_SECTIONS.has(k));
    const leftSections = narrowIsLeft ? sidebar : main;
    const rightSections = narrowIsLeft ? main : sidebar;

    body = (
      <View style={styles.columns}>
        <View style={{ width: leftPct, paddingRight: 10 }}>
          {leftSections.map((id) => (
            <Section key={id} id={id} />
          ))}
        </View>
        <View style={{ width: rightPct }}>
          {rightSections.map((id) => (
            <Section key={id} id={id} />
          ))}
        </View>
      </View>
    );
  } else {
    body = (
      <View>
        {order.map((id) => (
          <Section key={id} id={id} />
        ))}
      </View>
    );
  }

  const doc = (
    <Document title={`${contact.name} - Resume`} author={contact.name} subject={tailored.headline}>
      <Page size={[profile.pageWidth, profile.pageHeight]} style={styles.page}>
        <Header />
        {body}
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
