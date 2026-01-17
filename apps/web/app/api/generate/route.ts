import Anthropic from "@anthropic-ai/sdk";
import { decode } from "@toon-format/toon";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a UI generator that outputs TOON format.

TOON is a concise, indentation-based format that decodes to JSON with this structure:
{
  "root": "elementKey",
  "elements": {
    "elementKey": { "key": "elementKey", "type": "ComponentType", "props": {...}, "children": [...] },
    ...
  }
}

AVAILABLE COMPONENTS (22):

Layout:
- Card: { title?: string, description?: string, maxWidth?: "sm"|"md"|"lg"|"full", centered?: boolean } - Container card for content sections. Has children.
- Stack: { direction?: "horizontal"|"vertical", gap?: "sm"|"md"|"lg" } - Flex container. Has children.
- Grid: { columns?: 2|3|4, gap?: "sm"|"md"|"lg" } - Grid layout. Has children.
- Divider: {} - Horizontal separator line

Form Inputs:
- Input: { label: string, name: string, type?: "text"|"email"|"password"|"number", placeholder?: string } - Text input
- Textarea: { label: string, name: string, placeholder?: string, rows?: number } - Multi-line text
- Select: { label: string, name: string, options: string[], placeholder?: string } - Dropdown select
- Checkbox: { label: string, name: string, checked?: boolean } - Checkbox input
- Radio: { label: string, name: string, options: string[] } - Radio button group
- Switch: { label: string, name: string, checked?: boolean } - Toggle switch

Actions:
- Button: { label: string, variant?: "primary"|"secondary"|"danger", actionText?: string } - Clickable button
- Link: { label: string, href: string } - Anchor link

Typography:
- Heading: { text: string, level?: 1|2|3|4 } - Heading text (h1-h4)
- Text: { content: string, variant?: "body"|"caption"|"muted" } - Paragraph text

Data Display:
- Image: { src: string, alt: string, width?: number, height?: number } - Image
- Avatar: { src?: string, name: string, size?: "sm"|"md"|"lg" } - User avatar
- Badge: { text: string, variant?: "default"|"success"|"warning"|"danger" } - Status badge
- Alert: { title: string, message?: string, type?: "info"|"success"|"warning"|"error" } - Alert banner
- Progress: { value: number, max?: number, label?: string } - Progress bar
- Rating: { value: number, max?: number, label?: string } - Star rating

Charts:
- BarGraph: { title?: string, data: Array<{label: string, value: number}> } - Vertical bar chart
- LineGraph: { title?: string, data: Array<{label: string, value: number}> } - Line chart

OUTPUT FORMAT (TOON):

TOON uses YAML-like indentation. Each element has: key, type, props (indented), and children[N].

Example TOON:

root: card
elements:
  card:
    key: card
    type: Card
    props:
      title: Contact Us
      maxWidth: md
    children[4]: name,email,message,submit
  name:
    key: name
    type: Input
    props:
      label: Name
      name: name
  email:
    key: email
    type: Input
    props:
      label: Email
      name: email
  message:
    key: message
    type: Textarea
    props:
      label: Message
      name: message
  submit:
    key: submit
    type: Button
    props:
      label: Send Message
      variant: primary

TOON SYNTAX RULES:
1. First line: "root: elementKey"
2. "elements:" followed by indented element definitions
3. Each element has: key, type, props (with indented properties), and children[N]
4. children[N] where N is the count, followed by comma-separated child keys
5. Use 2-space indentation consistently
6. Props with spaces or special chars need quotes: "Forgot password?"
7. Simple single words don't need quotes: Name, Email, primary, sm, md
8. Numbers and booleans are unquoted: 1, 2, true, false
9. Arrays in props: options[3]: Option1,Option2,Option3

MOBILE-FIRST RESPONSIVE:
- Design mobile-first. Single column on mobile, expand on larger screens.
- For forms: Card should be the root element

IMPORTANT OUTPUT RULES:
- Output ONLY the raw TOON format
- DO NOT wrap in markdown code blocks
- DO NOT add explanatory text
- Start with "root: " and end with the last property
- Use consistent 2-space indentation

Generate TOON:`;

const MAX_PROMPT_LENGTH = 140;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: Request) {
  const { prompt } = await req.json();

  const sanitizedPrompt = String(prompt || "").slice(0, MAX_PROMPT_LENGTH);

  // Track request duration
  const startTime = Date.now();

  const stream = await anthropic.messages.stream({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    temperature: 0.7,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: sanitizedPrompt,
      },
    ],
  });

  // Accumulate the complete LLM response and track usage
  let fullResponse = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      fullResponse += chunk.delta.text;
    }

    // Capture usage information from the final message
    if (chunk.type === "message_start") {
      inputTokens = chunk.message.usage.input_tokens;
    }

    if (chunk.type === "message_delta") {
      outputTokens = chunk.usage.output_tokens;
    }
  }

  // Calculate duration
  const endTime = Date.now();
  const durationMs = endTime - startTime;

  // Calculate cost based on Claude Opus 4.5 pricing
  // Input: $5 per million tokens
  // Output: $25 per million tokens
  const inputCost = (inputTokens / 1_000_000) * 5;
  const outputCost = (outputTokens / 1_000_000) * 25;
  const totalCost = inputCost + outputCost;

  console.log(`Token usage - Input: ${inputTokens}, Output: ${outputTokens}`);
  console.log(
    `Cost - Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)}, Total: $${totalCost.toFixed(6)}`,
  );
  console.log(`Duration: ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

  // Decode the TOON format
  const decoded = decode(fullResponse) as {
    root: string;
    elements: Record<string, unknown>;
  };

  // Convert decoded result to JSON Patches for the frontend
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        if (decoded.root) {
          const rootPatch = JSON.stringify({
            op: "set",
            path: "/root",
            value: decoded.root,
          });
          controller.enqueue(encoder.encode(rootPatch + "\n"));
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (decoded.elements) {
          for (const [key, element] of Object.entries(decoded.elements)) {
            const elementPatch = JSON.stringify({
              op: "set",
              path: `/elements/${key}`,
              value: element,
            });
            controller.enqueue(encoder.encode(elementPatch + "\n"));
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Input-Tokens": inputTokens.toString(),
      "X-Output-Tokens": outputTokens.toString(),
      "X-Total-Cost": totalCost.toFixed(6),
      "X-Input-Cost": inputCost.toFixed(6),
      "X-Output-Cost": outputCost.toFixed(6),
      "X-Duration-Ms": durationMs.toString(),
    },
  });
}
