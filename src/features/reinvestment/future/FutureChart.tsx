
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Legend
} from 'recharts'
import { useTranslation } from 'react-i18next'

type Props = {
    data: {
        date: string
        invested: number
        value: number
        shares: number
    }[]
}

export default function FutureChart({ data }: Props) {
    const { t } = useTranslation()

    return (
        <div style={{ width: '100%', height: 400, background: 'var(--bg-secondary)', borderRadius: '12px', padding: '1.5rem' }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={data}
                    margin={{
                        top: 10,
                        right: 30,
                        left: 0,
                        bottom: 0,
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                    <XAxis
                        dataKey="date"
                        tickFormatter={(val) => val.substring(2)} // '24-01'
                        stroke="var(--text-tertiary)"
                        fontSize={12}
                        tickMargin={10}
                    />
                    <YAxis
                        stroke="var(--text-tertiary)"
                        fontSize={12}
                        tickFormatter={(val) => `$${val.toLocaleString()}`}
                    />
                    <Tooltip
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', background: 'var(--bg-primary)' }}
                        formatter={(value: number | undefined) => [
                            typeof value === 'number' ? `$${value.toLocaleString()}` : '-',
                            ''
                        ]}
                        labelStyle={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />

                    <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--primary-color)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="var(--primary-color)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8884d8" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                        </linearGradient>
                    </defs>

                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke="var(--primary-color)"
                        fillOpacity={1}
                        fill="url(#colorValue)"
                        name={t('future.chart.portfolioValue')}
                        strokeWidth={2}
                    />
                    <Area
                        type="monotone"
                        dataKey="invested"
                        stroke="#8884d8"
                        fillOpacity={1}
                        fill="url(#colorInvested)"
                        name={t('future.chart.investedAmount')}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}
