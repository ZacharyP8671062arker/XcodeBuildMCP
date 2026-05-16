import type { RuntimeKind } from '../../runtime/types.ts';
import type { NextStep, ToolResponse } from '../../types/common.ts';
import { formatNextStep } from './next-step-formatting.ts';

export function renderNextStep(step: NextStep, runtime: RuntimeKind): string {
  return formatNextStep(step, { runtime });
}

export function renderNextStepsSection(steps: NextStep[], runtime: RuntimeKind): string {
  if (steps.length === 0) {
    return '';
  }

  const sorted = [...steps].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const lines = sorted.map((step, index) => `${index + 1}. ${renderNextStep(step, runtime)}`);

  return `Next steps:\n${lines.join('\n')}`;
}

export function processToolResponse(response: ToolResponse, runtime: RuntimeKind): ToolResponse {
  const { nextSteps, ...rest } = response;

  if (!nextSteps || nextSteps.length === 0) {
    return { ...rest };
  }

  const nextStepsSection = renderNextStepsSection(nextSteps, runtime);
  const processedContent = [...response.content];
  const lastIndex = processedContent.length - 1;
  const lastItem = lastIndex >= 0 ? processedContent[lastIndex] : undefined;

  if (lastItem?.type === 'text') {
    processedContent[lastIndex] = {
      ...lastItem,
      text: lastItem.text + '\n\n' + nextStepsSection,
    };
  } else if (!processedContent.some((item) => item.type === 'text') && nextStepsSection) {
    processedContent.push({ type: 'text', text: nextStepsSection.trim() });
  }

  return { ...rest, content: processedContent };
}
