import { PageHeader } from '@/ui'
import { EvaluationView } from '@/components/EvaluationView'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Company evaluation' }

export default function EvaluationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Company evaluation"
        description="Project revenue, apply P/E multiples, and discount back to a fair value today. Search a ticker to start from real data, then adjust the assumptions."
      />
      <EvaluationView />
    </div>
  )
}
