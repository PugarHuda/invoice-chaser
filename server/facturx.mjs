// Factur-X / ZUGFeRD (EN 16931 family): the invoice PDF carries a machine-readable UN/CEFACT CII XML
// (MINIMUM profile) so accounting software can import it without retyping. Amounts are in USD,
// settled 1:1 in USDC on Sui. Needs the seller's legal name and country (BT-27, BT-40), so it is on only
// when SELLER_NAME and SELLER_COUNTRY are set; SELLER_VAT_ID (BT-31) is optional.
// ponytail: the PDF itself is not PDF/A-3 (standard fonts are not embedded), so it does not claim
// pdfaid conformance; embed a TTF + sRGB OutputIntent if a validator must pass PDF/A too.
import { AFRelationship, PDFName } from 'pdf-lib'

export const seller = () => {
  const name = process.env.SELLER_NAME?.trim()
  const country = process.env.SELLER_COUNTRY?.trim().toUpperCase()
  return name && /^[A-Z]{2}$/.test(country || '') ? { name, country, vat: process.env.SELLER_VAT_ID?.trim() || null } : null
}

// XML 1.0 forbids C0 controls: drop them, then escape markup
// eslint-disable-next-line no-control-regex -- stripping C0 controls is the point (XML 1.0 forbids them)
const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
const ymd = (iso) => String(iso).slice(0, 10).replaceAll('-', '')
const cents = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2)

/** v: { id, issuedDate, client, total, due, seller: { name, country, vat } }  total/due in USD (= USDC) */
export function ciiXml(v) {
  const s = v.seller
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>${x(v.id)}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${ymd(v.issuedDate)}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty><ram:Name>${x(s.name)}</ram:Name><ram:PostalTradeAddress><ram:CountryID>${x(s.country)}</ram:CountryID></ram:PostalTradeAddress>${s.vat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(s.vat)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}</ram:SellerTradeParty>
<ram:BuyerTradeParty><ram:Name>${x(v.client)}</ram:Name></ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery/>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>USD</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:TaxBasisTotalAmount>${cents(v.total)}</ram:TaxBasisTotalAmount><ram:GrandTotalAmount>${cents(v.total)}</ram:GrandTotalAmount><ram:DuePayableAmount>${cents(v.due)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`
}

// Embed the XML the way Factur-X readers look for it: file "factur-x.xml", AFRelationship Alternative,
// referenced from the catalog /AF array, plus the fx: XMP block naming the profile.
export async function embedFacturX(doc, xml) {
  await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', {
    mimeType: 'text/xml',
    description: 'Factur-X invoice (CII, MINIMUM profile)',
    afRelationship: AFRelationship.Alternative,
    creationDate: new Date(),
    modificationDate: new Date(),
  })
  // pdf-lib embeds attachments on save; the ref is allocated now, so /AF can point at it already
  const file = doc.embeddedFiles.at(-1)
  doc.catalog.set(PDFName.of('AF'), doc.context.obj([file.ref]))
  // eslint-disable-next-line no-irregular-whitespace -- the XMP packet header must contain a literal BOM
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>MINIMUM</fx:ConformanceLevel></rdf:Description>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`
  const meta = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(meta))
  doc.setKeywords(['Factur-X', 'ZUGFeRD', 'MINIMUM'])
}
